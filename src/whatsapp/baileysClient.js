import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import NodeCache from "node-cache";
import { ulid } from "ulid";
import Pino from "pino";
import { Boom } from "@hapi/boom";
import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { logger as appLogger } from "../logger.js";
import { postWebhook } from "../services/webhook.js";
import { SimpleQueue } from "../utils/queue.js";
import {
  upsertSessionMeta,
  listSessionMeta,
  getSessionMeta,
} from "./sessionRegistry.js";
import { config } from "../config.js";

function authDirOf(id) {
  return path.resolve(__dirname, "../../credentials", `auth_${id}`);
}

async function purgeCreds(id) {
  const dir = authDirOf(id);
  if (fs.existsSync(dir)) {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

const logger = Pino({
  level: process.env.NODE_ENV === "development" ? "debug" : "info",
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Map runtime: id -> SessionCtx */
const sessions = new Map();

/** Cache QR per session */
const qrCache = new NodeCache({ stdTTL: 60, checkperiod: 30 });

/** Untuk abaikan jid yang bukan user/chat biasa */
function isIgnorableJid(jid) {
  if (!jid) return true;
  return (
    jid.endsWith("@newsletter") ||
    jid.endsWith("@broadcast") ||
    jid === "status@broadcast"
  );
}

/** Utility jitter ms */
const jitter = (ms) => Math.floor(ms * (0.8 + Math.random() * 0.4));

/** =========================
 *  PUBLIC API
 *  ========================= */

/** Merge: meta persisted + runtime live */
export function listSessions() {
  const metas = new Map(listSessionMeta().map((m) => [m.id, m]));
  const merged = new Map();

  // dari meta → status 'stopped'
  for (const [id, m] of metas.entries()) {
    merged.set(id, {
      id,
      status: "stopped",
      label: m.label || id,
      autoStart: m.autoStart !== false,
      webhookUrl: m.webhookUrl || "",
      webhookSecret: m.webhookSecret || "",
      createdAt: m.createdAt,
      attempts: 0,
    });
  }

  // timpa dengan runtime (open/starting/reconnecting/closed)
  for (const [id, s] of sessions.entries()) {
    const m = metas.get(id) || {};
    merged.set(id, {
      id,
      status: s.status || "starting",
      me: s.me,
      pushName: s.pushName,
      lastConn: s.lastConn,
      label: m.label || id,
      autoStart: m.autoStart !== false,
      webhookUrl: m.webhookUrl || "",
      webhookSecret: m.webhookSecret || "",
      createdAt: m.createdAt,
      attempts: s.attempts || 0,
    });
  }

  return [...merged.values()].sort(
    (a, b) => (a.createdAt || 0) - (b.createdAt || 0)
  );
}

export function getSession(id) {
  return sessions.get(id);
}

export function getQR(id) {
  return qrCache.get(id) || null;
}

/**
 * Create + Start session (persist meta)
 * @param {{id?:string, socketServer?:import("socket.io").Server, webhook?:{url?:string,secret?:string}, label?:string, autoStart?:boolean}} args
 */
export async function createSession({
  id,
  socketServer,
  webhook,
  label,
  autoStart = true,
}) {
  const sessId = id || ulid();
  if (sessions.has(sessId)) return sessions.get(sessId);

  // persist meta dulu agar muncul di list meski belum open
  const meta = upsertSessionMeta({
    id: sessId,
    label,
    webhookUrl: webhook?.url || "",
    webhookSecret: webhook?.secret || "",
    autoStart,
  });

  const authDir = path.resolve(
    __dirname,
    "../../credentials",
    `auth_${sessId}`
  );
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion().catch(() => ({
    version: undefined,
  }));

  const sctx = {
    id: sessId,
    status: "starting",
    me: null,
    pushName: null,
    lastConn: null,
    webhook: { url: meta.webhookUrl, secret: meta.webhookSecret },
    queue: new SimpleQueue(),
    attempts: 0,
    timer: null,
    sock: null,

    state,
    saveCreds,
    version,
    socketServer,
  };

  sessions.set(sessId, sctx);
  await startSocket(sctx); // boot pertama
  return sctx;
}

/** Hentikan & hapus dari runtime (TIDAK menghapus kredensial disk/meta) */
export async function deleteSession(id) {
  const s = sessions.get(id);
  if (!s) return false;
  try {
    if (s.timer) clearTimeout(s.timer);
    await s.sock?.end?.(); // lebih bersih dari logout(), tidak mencabut sesi dari server
  } catch {}
  sessions.delete(id);
  return true;
}

/**
 * Bootstrap semua sesi dari registry (autostart=true)
 */
export async function bootstrapSessions(socketServer) {
  const metas = listSessionMeta();
  for (const m of metas) {
    if (m.autoStart === false) continue;
    try {
      await createSession({
        id: m.id,
        socketServer,
        webhook: { url: m.webhookUrl, secret: m.webhookSecret },
        label: m.label,
        autoStart: true,
      });
    } catch (e) {
      appLogger.error({ err: e, id: m.id }, "[bootstrap] create failed");
    }
  }
}

/** =========================
 *  INTERNALS
 *  ========================= */

async function startSocket(sctx) {
  if (sctx.timer) {
    clearTimeout(sctx.timer);
    sctx.timer = null;
  }

  const sock = makeWASocket({
    version: sctx.version,
    auth: sctx.state,
    printQRInTerminal: false,
    browser: ["Detopupin-API", "Chrome", "1.0.0"],
    connectTimeoutMs: 30_000,
    syncFullHistory: false,
    markOnlineOnConnect: false,
    defaultQueryTimeoutMs: 20_000,
    emitOwnEvents: true,
    proxyAgent: config.proxy
      ? new (await import("https-proxy-agent")).HttpsProxyAgent(config.proxy)
      : undefined,
    logger,
  });

  sctx.sock = sock;

  sock.ev.on("creds.update", sctx.saveCreds);

  sock.ev.on("connection.update", (u) => {
    const { connection, lastDisconnect, qr } = u;

    if (qr) {
      qrCache.set(sctx.id, qr, 60);
      sctx.socketServer?.to(sctx.id).emit("qr", { id: sctx.id, qr });
      // postWebhook({
      //   url: sctx.webhook?.url,
      //   secret: sctx.webhook?.secret,
      //   event: "session_qr",
      //   payload: { id: sctx.id, qr },
      // }).catch(() => {});
    }

    if (connection === "open") {
      sctx.attempts = 0;
      sctx.status = "open";
      sctx.me = sock.user;
      sctx.pushName = sock?.user?.name || null;
      sctx.lastConn = Date.now();

      sctx.socketServer
        ?.to(sctx.id)
        .emit("ready", { id: sctx.id, me: sock.user });

      postWebhook({
        url: sctx.webhook?.url,
        secret: sctx.webhook?.secret,
        event: "session_open",
        payload: { id: sctx.id, me: sock.user },
      }).catch(() => {});

      logger.info(
        { class: "baileys", id: sctx.id, me: sock.user },
        "connection open"
      );
    }

    if (connection === "close") {
      const boom = new Boom(lastDisconnect?.error);
      const code =
        boom?.output?.statusCode ??
        lastDisconnect?.error?.output?.statusCode ??
        lastDisconnect?.error?.statusCode ??
        0;

      const isLoggedOut = code === DisconnectReason.loggedOut;

      logger.warn(
        { class: "baileys", id: sctx.id, code, msg: "connection close" },
        "socket closed"
      );

      if (isLoggedOut) {
        sctx.status = "logged_out";
        sctx.socketServer
          ?.to(sctx.id)
          .emit("closed", { id: sctx.id, reason: code });

        // postWebhook({
        //   url: sctx.webhook?.url,
        //   secret: sctx.webhook?.secret,
        //   event: "session_logged_out",
        //   payload: { id: sctx.id },
        // }).catch(() => {});
        (async () => {
          try {
            await purgeCreds(sctx.id);

            const { state, saveCreds } = await useMultiFileAuthState(
              authDirOf(sctx.id)
            );
            sctx.state = state;
            sctx.saveCreds = saveCreds;

            sctx.attempts = 0;
            sctx.status = "starting";

            await startSocket(sctx); // menyalakan ulang: UI akan menerima event 'qr'
          } catch (e) {
            logger.error(
              { err: e, id: sctx.id },
              "relaunch after logout failed"
            );
          }
        })();
        return;
      }

      sctx.status = "reconnecting";
      sctx.attempts += 1;
      const base = Math.min(30_000, 1_000 * 2 ** Math.min(sctx.attempts, 5)); // 1s → 32s (cap 30s)
      const delay = jitter(base);

      logger.info(
        { class: "baileys", id: sctx.id, code, attempts: sctx.attempts, delay },
        "scheduling reconnect"
      );

      sctx.timer = setTimeout(async () => {
        try {
          await startSocket(sctx);
        } catch (e) {
          logger.error({ err: e, id: sctx.id }, "reconnect failed");
        }
      }, delay);
    }
  });

  sock.ev.on("messages.upsert", async (m) => {
    const msg = m.messages?.[0];
    if (!msg || msg.key.fromMe) return;
    if (isIgnorableJid(msg.key.remoteJid)) return;

    try {
      await postWebhook({
        url: sctx.webhook?.url,
        secret: sctx.webhook?.secret,
        event: "message_received",
        payload: { id: sctx.id, message: msg },
      });
    } catch {}

    logger.info(
      {
        class: "baileys",
        id: sctx.id,
        from: msg.key.remoteJid,
        type: Object.keys(msg.message || {})[0],
      },
      "message received"
    );

    // Auto-reply testing
    try {
      const text =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.ephemeralMessage?.message?.extendedTextMessage?.text ||
        "";

      if (config.autoReply?.enabled && text) {
        if (config.autoReply?.pingPong && /^ping$/i.test(text.trim())) {
          const from = msg.key.remoteJid;
          await sctx.queue.push(async () => {
            await sock.sendMessage(from, { text: "pong" }, { quoted: msg });
          });
        }
      }

      // — Contoh integrasi AI —
      // if (process.env.GOOGLE_API_KEY && text) {
      //   const reply = await callGemini(text);
      //   if (reply) {
      //     await sctx.queue.push(async () => {
      //       await sock.sendMessage(msg.key.remoteJid, { text: reply }, { quoted: msg });
      //     });
      //   }
      // }
    } catch (e) {
      logger.warn({ err: e?.message }, "auto-reply failed");
    }
  });
}

/** =========================
 *  Helper AI Gemini
 *  ========================= */
// async function callGemini(input) {
//   try {
//     const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GOOGLE_API_KEY}`, {
//       method: "POST",
//       headers: { "Content-Type": "application/json" },
//       body: JSON.stringify({
//         contents: [{ role: "user", parts: [{ text: input }]}],
//         generation_config: { temperature: 0.2, maxOutputTokens: 512 },
//       })
//     });
//     const data = await resp.json();
//     return data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
//   } catch (_) { return null; }
// }
