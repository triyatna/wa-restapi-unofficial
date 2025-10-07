import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import NodeCache from "node-cache";
import { ulid } from "ulid";
import { logger } from "../logger.js";
import { postWebhook } from "../services/webhook.js";
import { SimpleQueue } from "../utils/queue.js";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "../config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sessions = new Map(); // id -> SessionCtx
const qrCache = new NodeCache({ stdTTL: 60, checkperiod: 30 });
function isIgnorableJid(jid) {
  if (!jid) return true;
  return (
    jid.endsWith("@newsletter") ||
    jid.endsWith("@broadcast") ||
    jid === "status@broadcast"
  );
}

/** Utility: jitter ms */
const jitter = (ms) => Math.floor(ms * (0.8 + Math.random() * 0.4));

export function listSessions() {
  return Array.from(sessions.values()).map((s) => ({
    id: s.id,
    status: s.status,
    me: s.me,
    pushName: s.pushName,
    lastConn: s.lastConn,
    webhook: s.webhook,
    attempts: s.attempts,
  }));
}

export async function createSession({ id, socketServer, webhook }) {
  const sessId = id || ulid();
  if (sessions.has(sessId)) return sessions.get(sessId);

  const authDir = path.resolve(
    __dirname,
    "../../credentials",
    `auth_${sessId}`
  );
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();

  const sctx = {
    id: sessId,
    status: "starting",
    me: null,
    pushName: null,
    lastConn: null,
    webhook: webhook || null,
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

async function startSocket(sctx) {
  // bersihkan timer reconnect sebelumnya
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
  });

  sctx.sock = sock;

  sock.ev.on("creds.update", sctx.saveCreds);

  sock.ev.on("connection.update", (u) => {
    const { connection, lastDisconnect, qr } = u;

    if (qr) {
      qrCache.set(sctx.id, qr, 60);
      sctx.socketServer?.to(sctx.id).emit("qr", { id: sctx.id, qr });
    }

    if (connection === "open") {
      // reset backoff
      sctx.attempts = 0;
      sctx.status = "open";
      sctx.me = sock.user;
      sctx.pushName = sock?.user?.name;
      sctx.lastConn = Date.now();

      sctx.socketServer
        ?.to(sctx.id)
        .emit("ready", { id: sctx.id, me: sock.user });
      postWebhook({
        url: sctx.webhook?.url,
        secret: sctx.webhook?.secret,
        event: "session_open",
        payload: { id: sctx.id, me: sock.user },
      });
      logger.info(
        { class: "baileys", id: sctx.id, me: sock.user },
        "connection open"
      );
    }

    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
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
        // JANGAN hapus kredensial otomatis—biarkan admin yang putuskan (opsional)
        return;
      }

      // kode 515 / kondisi lain → coba restart (exponential backoff)
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

  // Webhook + auto-reply
  sock.ev.on("messages.upsert", async (m) => {
    const msg = m.messages?.[0];
    if (!msg || msg.key.fromMe) return;
    if (isIgnorableJid(msg.key.remoteJid)) return;
    try {
      postWebhook({
        url: sctx.webhook?.url,
        secret: sctx.webhook?.secret,
        event: "message_received",
        payload: { id: sctx.id, message: msg },
      });
      logger.info(
        {
          class: "baileys",
          id: sctx.id,
          from: msg.key.remoteJid,
          type: Object.keys(msg.message || {})[0],
          message: msg.message || null,
        },
        "message received"
      );
      // Auto-reply (jika diaktifkan)
      const text =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.ephemeralMessage?.message?.extendedTextMessage?.text ||
        "";
      // ini bisa tambahkan case semaunya aja
      switch (text.trim().toLowerCase()) {
        case "hai":
          await sock.sendMessage(
            msg.key.remoteJid,
            { text: "Halo!" },
            { quoted: msg }
          );
          break;
      }

      if (text.trim()) {
        fetch(
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              contents: {
                role: "user",
                parts: [{ text: text }],
              },
              generation_config: {
                temperature: 0.2,
                maxOutputTokens: 1024,
              },
            }),
          }
        )
          .then((response) => response.json())
          .then((data) => {
            logger.info({ data }, "Response dari AI");
            if (!data?.candidates?.[0]?.content?.parts?.[0]) return;
            // ambil text
            const reply = data.candidates[0].content.parts[0].text;
            sock.sendMessage(
              msg.key.remoteJid,
              { text: reply },
              { quoted: msg }
            );
          })
          .catch((error) => {
            console.error("Error:", error);
          });
      }
      if (config.autoReply?.enabled) {
        const text =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          msg.message?.ephemeralMessage?.message?.extendedTextMessage?.text ||
          "";
        if (config.autoReply?.pingPong && /^ping$/i.test((text || "").trim())) {
          const from = msg.key.remoteJid;
          await new Promise((resolve) =>
            sctx.queue.push(async () => {
              await sock.sendMessage(from, { text: "pong" }, { quoted: msg });
              resolve();
            })
          );
        }
      }
    } catch (e) {
      // noop
    }
  });
}

/** helpers */
export function getSession(id) {
  return sessions.get(id) || null;
}

export async function deleteSession(id) {
  const s = sessions.get(id);
  if (!s) return false;
  try {
    // bersihkan timer agar tidak auto-reconnect lagi
    if (s.timer) clearTimeout(s.timer);
    await s.sock?.logout?.();
  } catch {}
  sessions.delete(id);
  return true;
}

export function getQR(id) {
  return qrCache.get(id) || null;
}
