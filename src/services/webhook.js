// src/webhooks/webhook.js
import axios from "axios";
import { hmacSign } from "../utils/crypto.js";
import { logger } from "../logger.js";
import { getSession } from "../whatsapp/baileysClient.js";

// opsi default
const DEFAULTS = {
  timeout: 10000,
  retries: 3,
  backoffMs: 800, // base
  jitter: 300,
  delayMsActions: 1200,
};

// circuit breaker state (sederhana)
const circuit = new Map(); // url -> { fail: number, openUntil: ts }

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function jittered(ms, j) {
  return ms + Math.floor(Math.random() * j);
}
function pickArray(v) {
  return Array.isArray(v) ? v : v ? [v] : [];
}

function isRetryable(err) {
  if (!err) return false;
  const code = err.response?.status;
  if (!code) return true; // network
  if (code === 429) return true;
  if (code >= 500) return true;
  return false;
}

function isCircuitOpen(url) {
  const s = circuit.get(url);
  return s && s.openUntil && Date.now() < s.openUntil;
}

function markCircuit(url, ok) {
  const s = circuit.get(url) || { fail: 0, openUntil: 0 };
  if (ok) {
    s.fail = 0;
    s.openUntil = 0;
  } else {
    s.fail++;
    if (s.fail >= 5) {
      // buka 1 menit
      s.openUntil = Date.now() + 60_000;
    }
  }
  circuit.set(url, s);
}

function renderTemplate(str, ctx) {
  if (typeof str !== "string") return str;
  return str.replace(/\{\{([^}]+)\}\}/g, (_, k) => {
    const path = k.trim().split(".");
    let v = ctx;
    for (const p of path) {
      v = v?.[p];
    }
    return v == null ? "" : String(v);
  });
}
function renderDeep(obj, ctx) {
  if (obj == null) return obj;
  if (Array.isArray(obj)) return obj.map((x) => renderDeep(x, ctx));
  if (typeof obj === "object") {
    const o = {};
    for (const [k, v] of Object.entries(obj)) {
      o[k] = renderDeep(v, ctx);
    }
    return o;
  }
  return renderTemplate(obj, ctx);
}

// Eksekusi 1 aksi via internal REST primitives
async function runAction(sessionId, action) {
  const s = getSession(sessionId);
  if (!s) throw new Error("session not found");

  const to = action.to;
  const jid =
    to.endsWith("@s.whatsapp.net") || to.endsWith("@g.us")
      ? to
      : `${String(to).replace(/\D/g, "")}@s.whatsapp.net`;

  await s.queue.push(async () => {
    switch (action.type) {
      case "text":
        await s.sock.sendMessage(jid, {
          text: action.text,
          mentions: (action.mentions || []).map(
            (x) => `${String(x).replace(/\D/g, "")}@s.whatsapp.net`
          ),
        });
        break;
      case "media":
        if (action.mediaType === "image") {
          const buf = await fetchBuffer(action.url);
          await s.sock.sendMessage(jid, {
            image: buf.buffer,
            mimetype: buf.mime,
            caption: action.caption,
          });
        } else if (action.mediaType === "video" || action.mediaType === "gif") {
          const buf = await fetchBuffer(action.url);
          await s.sock.sendMessage(jid, {
            video: buf.buffer,
            mimetype: buf.mime,
            gifPlayback: action.mediaType === "gif",
            caption: action.caption,
          });
        } else if (action.mediaType === "audio") {
          const buf = await fetchBuffer(action.url);
          await s.sock.sendMessage(jid, {
            audio: buf.buffer,
            mimetype: buf.mime,
            ptt: true,
          });
        } else {
          throw new Error("unsupported mediaType");
        }
        break;
      case "document": {
        const buf = await fetchBuffer(action.url);
        await s.sock.sendMessage(jid, {
          document: buf.buffer,
          mimetype: buf.mime,
          fileName:
            action.filename || `file.${buf.mime.split("/")[1] || "bin"}`,
          caption: action.caption,
        });
        break;
      }
      case "location":
        await s.sock.sendMessage(jid, {
          location: {
            degreesLatitude: action.lat,
            degreesLongitude: action.lng,
            name: action.name,
            address: action.address,
          },
        });
        break;
      case "sticker": {
        // sederhana: kirim gambar sebagai sticker via sharp→webp
        const { default: sharp } = await import("sharp");
        let buf;
        if (action.webpUrl) {
          const w = await fetchBuffer(action.webpUrl);
          buf = w.buffer;
        } else {
          const img = await fetchBuffer(action.imageUrl);
          buf = await sharp(img.buffer)
            .resize(512, 512, { fit: "inside", withoutEnlargement: true })
            .webp({ quality: 95 })
            .toBuffer();
        }
        await s.sock.sendMessage(jid, { sticker: buf });
        break;
      }
      case "vcard": {
        const v = buildVCard(action.contact || {});
        await s.sock.sendMessage(jid, {
          contacts: {
            displayName: action.contact?.fullName || "Contact",
            contacts: [{ vcard: v }],
          },
        });
        break;
      }
      case "buttons":
      case "list":
      case "poll":
        // delegasikan ke message objek langsung:
        await s.sock.sendMessage(jid, action.message);
        break;
      case "forward":
      case "raw":
        await s.sock.sendMessage(jid, action.message);
        break;
      case "noop":
        break;
      default:
        throw new Error("unknown action type");
    }
  });
}

async function fetchBuffer(url) {
  const resp = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 20_000,
  });
  const ct = resp.headers["content-type"] || "application/octet-stream";
  return { buffer: Buffer.from(resp.data), mime: ct };
}
function buildVCard({ fullName, org, phone, email }) {
  const num = (phone || "").replace(/\D/g, "");
  return [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${fullName || ""}`,
    org ? `ORG:${org}` : "",
    num ? `TEL;type=CELL;type=VOICE;waid=${num}:${num}` : "",
    email ? `EMAIL:${email}` : "",
    "END:VCARD",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Kirim event ke 1..N webhook URLs.
 * @param {Object} cfg
 *   - url: string | string[]
 *   - secret: string | string[]     (mendukung rotasi; tanda tangan pakai secret[0])
 *   - event: string
 *   - payload: object
 *   - sessionId: string  (untuk aksi response)
 *   - options: { timeout?, retries?, backoffMs?, jitter?, delayMsActions? }
 */
export async function postWebhook({
  url,
  secret,
  event,
  payload,
  sessionId,
  options = {},
}) {
  const urls = pickArray(url);
  if (!urls.length) return;

  const secrets = pickArray(secret);
  const mainSecret = secrets[0] || "";
  const opts = { ...DEFAULTS, ...options };

  const body = { event, data: payload, ts: Date.now() };
  const json = JSON.stringify(body);
  const sig = hmacSign(json, mainSecret);

  for (const target of urls) {
    if (isCircuitOpen(target)) {
      logger.warn({ target }, "webhook circuit open, skip");
      continue;
    }

    let attempt = 0,
      delivered = false,
      lastErr = null;
    while (attempt <= opts.retries && !delivered) {
      attempt++;
      try {
        const resp = await axios.post(target, body, {
          headers: {
            "Content-Type": "application/json",
            "X-Webhook-Signature": sig,
            "X-Webhook-Timestamp": String(body.ts),
            "X-Webhook-Event": event,
            "X-Event-Id": payload?.eventId || payload?.id || undefined,
          },
          timeout: opts.timeout,
        });

        markCircuit(target, true);
        delivered = true;

        // ==== Mode dua arah: jalankan actions dari respon webhook ====
        const actions = resp?.data?.actions;
        if (actions && Array.isArray(actions) && actions.length) {
          const ctx = { ...body, ...payload }; // konteks template
          const delay = Number(resp?.data?.delayMs || opts.delayMsActions);
          for (const raw of actions) {
            const action = renderDeep(raw, ctx); // render {{from}} dkk
            try {
              await runAction(sessionId || payload?.sessionId, action);
            } catch (e) {
              logger.warn({ action, err: e?.message }, "webhook action failed");
            }
            await sleep(delay);
          }
        }
      } catch (err) {
        lastErr = err;
        const retry = isRetryable(err);
        markCircuit(target, false);
        logger.warn(
          { target, attempt, code: err.response?.status, err: err?.message },
          "Webhook deliver failed"
        );
        if (!retry || attempt > opts.retries) break;
        const wait = jittered(
          opts.backoffMs * Math.pow(2, attempt - 1),
          opts.jitter
        );
        await sleep(wait);
      }
    }

    if (!delivered) {
      // dead-letter (log saja, jangan crash)
      logger.warn({ target }, "Webhook permanently failed");
    }
  }
}
