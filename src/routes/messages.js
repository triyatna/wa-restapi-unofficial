import express from "express";
import mime from "mime-types";
import axios from "axios";
import { apiKeyAuth } from "../middleware/auth.js";
import { dynamicRateLimit } from "../middleware/ratelimit.js";
import { antiSpam } from "../middleware/antispam.js";
import { getSession } from "../whatsapp/baileysClient.js";
import mediaFileRouter from "./media-file.js";

const router = express.Router();
router.use(apiKeyAuth("user"), dynamicRateLimit(), antiSpam());

function jidify(phone) {
  const p = String(phone).replace(/\D/g, "");
  return p.endsWith("@s.whatsapp.net") ? p : p + "@s.whatsapp.net";
}

async function fetchBuffer(url) {
  const resp = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 20000,
  });
  const ct = resp.headers["content-type"] || "application/octet-stream";
  return { buffer: Buffer.from(resp.data), mime: ct };
}

router.post("/text", async (req, res, next) => {
  try {
    const { sessionId, to, text, mentions } = req.body || {};
    const s = getSession(sessionId);
    if (!s) return res.status(404).json({ error: "Session not found" });
    await new Promise((resolve) =>
      s.queue.push(async () => {
        await s.sock.sendMessage(jidify(to), {
          text,
          mentions: (mentions || []).map(jidify),
        });
        resolve();
      })
    );
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.post("/media", async (req, res, next) => {
  try {
    const { sessionId, to, caption, mediaUrl, mediaType } = req.body || {};
    const s = getSession(sessionId);
    if (!s) return res.status(404).json({ error: "Session not found" });
    const { buffer, mime } = await fetchBuffer(mediaUrl);
    const opts = { caption };
    const jid = jidify(to);
    await new Promise((resolve) =>
      s.queue.push(async () => {
        if (mediaType === "image")
          await s.sock.sendMessage(jid, {
            image: buffer,
            mimetype: mime,
            ...opts,
          });
        else if (mediaType === "video")
          await s.sock.sendMessage(jid, {
            video: buffer,
            mimetype: mime,
            ...opts,
          });
        else if (mediaType === "audio")
          await s.sock.sendMessage(jid, {
            audio: buffer,
            mimetype: mime,
            ptt: true,
          });
        else if (mediaType === "document")
          await s.sock.sendMessage(jid, {
            document: buffer,
            mimetype: mime,
            fileName: `file.${mime.split("/")[1] || "bin"}`,
          });
        else return res.status(400).json({ error: "Unsupported mediaType" });
        resolve();
      })
    );
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.use(mediaFileRouter);

router.post("/location", async (req, res, next) => {
  try {
    const { sessionId, to, lat, lng, name, address } = req.body || {};
    const s = getSession(sessionId);
    if (!s) return res.status(404).json({ error: "Session not found" });
    await new Promise((resolve) =>
      s.queue.push(async () => {
        await s.sock.sendMessage(jidify(to), {
          location: {
            degreesLatitude: lat,
            degreesLongitude: lng,
            name,
            address,
          },
        });
        resolve();
      })
    );
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.post("/forward", async (req, res, next) => {
  try {
    const { sessionId, to, key, message } = req.body || {};
    const s = getSession(sessionId);
    if (!s) return res.status(404).json({ error: "Session not found" });
    await new Promise((resolve) =>
      s.queue.push(async () => {
        await s.sock.sendMessage(jidify(to), message, {
          quoted: key ? { key } : undefined,
        });
        resolve();
      })
    );
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// --- Buttons (template quick replies) ---
router.post("/buttons", async (req, res, next) => {
  try {
    const { sessionId, to, text, footer, buttons } = req.body || {};
    const s = getSession(sessionId);
    if (!s) return res.status(404).json({ error: "Session not found" });
    const templateButtons = (buttons || []).slice(0, 3).map((b, i) => ({
      index: i + 1,
      quickReplyButton: {
        id: b.id || `btn_${i + 1}`,
        displayText: b.text || `Button ${i + 1}`,
      },
    }));
    await new Promise((resolve) =>
      s.queue.push(async () => {
        await s.sock.sendMessage(jidify(to), { text, footer, templateButtons });
        resolve();
      })
    );
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// --- List message ---
router.post("/list", async (req, res, next) => {
  try {
    const { sessionId, to, title, text, footer, buttonText, sections } =
      req.body || {};
    const s = getSession(sessionId);
    if (!s) return res.status(404).json({ error: "Session not found" });
    await new Promise((resolve) =>
      s.queue.push(async () => {
        await s.sock.sendMessage(jidify(to), {
          text,
          footer,
          title,
          buttonText: buttonText || "Open",
          sections: sections || [],
        });
        resolve();
      })
    );
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// --- Poll ---
router.post("/poll", async (req, res, next) => {
  try {
    const { sessionId, to, name, options, selectableCount } = req.body || {};
    const s = getSession(sessionId);
    if (!s) return res.status(404).json({ error: "Session not found" });
    await new Promise((resolve) =>
      s.queue.push(async () => {
        await s.sock.sendMessage(jidify(to), {
          poll: {
            name,
            values: options || [],
            selectableCount: selectableCount || 1,
          },
        });
        resolve();
      })
    );
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// --- Sticker (sharp -> webp) ---
router.post("/sticker", async (req, res, next) => {
  try {
    const { sessionId, to, imageUrl, webpUrl } = req.body || {};
    const s = getSession(sessionId);
    if (!s) return res.status(404).json({ error: "Session not found" });

    const { default: sharp } = await import("sharp");

    let buffer, mime;
    if (imageUrl) {
      ({ buffer, mime } = await fetchBuffer(imageUrl));
    } else if (webpUrl) {
      ({ buffer, mime } = await fetchBuffer(webpUrl));
    } else {
      return res.status(400).json({ error: "Provide imageUrl or webpUrl" });
    }

    const webp = await sharp(buffer)
      .resize(512, 512, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 95 })
      .toBuffer();

    await new Promise((resolve) =>
      s.queue.push(async () => {
        await s.sock.sendMessage(jidify(to), { sticker: webp });
        resolve();
      })
    );
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// --- vCard ---
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

router.post("/vcard", async (req, res, next) => {
  try {
    const { sessionId, to, contact } = req.body || {};
    const s = getSession(sessionId);
    if (!s) return res.status(404).json({ error: "Session not found" });
    const vcard = buildVCard(contact || {});
    await new Promise((resolve) =>
      s.queue.push(async () => {
        await s.sock.sendMessage(jidify(to), {
          contacts: {
            displayName: contact?.fullName || "Contact",
            contacts: [{ vcard }],
          },
        });
        resolve();
      })
    );
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// --- GIF (video with gifPlayback) ---
router.post("/gif", async (req, res, next) => {
  try {
    const { sessionId, to, videoUrl, caption } = req.body || {};
    const s = getSession(sessionId);
    if (!s) return res.status(404).json({ error: "Session not found" });
    const { buffer, mime } = await fetchBuffer(videoUrl);
    await new Promise((resolve) =>
      s.queue.push(async () => {
        await s.sock.sendMessage(jidify(to), {
          video: buffer,
          mimetype: mime,
          gifPlayback: true,
          caption,
        });
        resolve();
      })
    );
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

export default router;
