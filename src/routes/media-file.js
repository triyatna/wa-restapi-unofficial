import express from "express";
import { getSession } from "../whatsapp/baileysClient.js";
import { logger } from "../logger.js";

const router = express.Router();
// RAW: terima semua konten apa adanya (dibutuhkan untuk multipart custom & raw binary)
const rawAny = express.raw({ type: () => true, limit: "25mb" });

/**
 * POST /api/messages/media/file
 * - mode multipart/form-data: bisa banyak file (file|files|file1|apa saja yang punya filename)
 *   + fields yang didukung: sessionId, to, caption (global), captions[] (per-index), delayMs, mediaType (hint global), text (untuk kirim teks tanpa file)
 * - mode raw: 1 file (body), meta via query: ?sessionId&to&mediaType&caption&fileName&delayMs
 */
router.post("/media/file", rawAny, async (req, res, next) => {
  try {
    const contentType = String(req.headers["content-type"] || "").toLowerCase();
    let fields = {};
    let files = []; // [{data, headers, filename, partMime}]
    let isMultipart = false;

    if (contentType.startsWith("multipart/form-data")) {
      isMultipart = true;
      const boundary = getBoundary(contentType);
      if (!boundary)
        return res.status(400).json({ error: "Invalid multipart boundary" });

      const parsed = parseMultipartAll(req.body, boundary); // <— kumpulkan SEMUA file
      fields = parsed.fields || {};
      files = parsed.files || [];

      // meta JSON opsional
      if (typeof fields.meta === "string") {
        try {
          Object.assign(fields, JSON.parse(fields.meta));
        } catch {}
      }
    } else {
      // ---- Raw binary: 1 file dari body, meta dari query ----
      const buffer = req.body;
      if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        // izinkan kirim teks saja bila ada ?text= atau ?caption=
        const q = req.query || {};
        const sessionId = String(q.sessionId || "");
        const to = String(q.to || "");
        const text = q.text
          ? String(q.text)
          : q.caption
          ? String(q.caption)
          : "";
        if (!sessionId)
          return res.status(400).json({ error: "sessionId is required" });
        if (!to)
          return res.status(400).json({ error: "to (phone) is required" });
        if (!text)
          return res
            .status(400)
            .json({ error: "Empty binary body and no text" });

        const s = getSession(sessionId);
        if (!s) return res.status(404).json({ error: "Session not found" });

        const jid = jidify(to);
        await s.queue.push(async () => {
          await s.sock.sendMessage(jid, { text });
        });
        return res.json({
          ok: true,
          data: { sessionId, to: jid, sent: "text-only" },
        });
      }

      const q = req.query || {};
      fields = {
        sessionId: String(q.sessionId || ""),
        to: String(q.to || ""),
        caption: q.caption ? String(q.caption) : undefined,
        mediaType: q.mediaType ? String(q.mediaType) : undefined,
        delayMs: q.delayMs ? Number(q.delayMs) : undefined,
        fileName: q.fileName
          ? String(q.fileName)
          : guessNameFromType(contentType),
      };
      files = [
        {
          data: buffer,
          headers: { "content-type": contentType },
          filename: fields.fileName,
          partMime: contentType || "application/octet-stream",
        },
      ];
    }

    // Validasi field wajib
    const { sessionId, to } = fields;
    if (!sessionId)
      return res.status(400).json({ error: "sessionId is required" });
    if (!to) return res.status(400).json({ error: "to (phone) is required" });

    // Ambil session
    const s = getSession(sessionId);
    if (!s) return res.status(404).json({ error: "Session not found" });

    const jid = jidify(to);

    // Kirim teks saja bila tidak ada file di multipart
    const fallbackText = fields.text || fields.caption;
    if (isMultipart && (!files || files.length === 0)) {
      if (!fallbackText)
        return res.status(400).json({ error: "No file provided and no text" });
      await s.queue.push(async () => {
        await s.sock.sendMessage(jid, { text: fallbackText });
      });
      return res.json({
        ok: true,
        data: { sessionId, to: jid, sent: "text-only" },
      });
    }

    // Delay antar kirim — default 1200ms, minimal 300ms, maksimal 10000ms
    const delayMs = clampNumber(Number(fields.delayMs ?? 1200), 300, 10000);

    // Caption per-file (opsional): captions[]=...
    const captions = toArrayMaybe(fields.captions);

    // Hint mediaType global (opsional)
    const hintedGlobal = fields.mediaType;

    const results = [];
    for (let i = 0; i < files.length; i++) {
      const part = files[i];
      const buffer = part.data;
      if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        results.push({ index: i, error: "empty file" });
        continue;
      }
      const partMime =
        getHeaderValue(part.headers?.["content-type"]) ||
        part.partMime ||
        "application/octet-stream";
      const filename = part.filename || "file.bin";

      // Deteksi mime & tipe kirim
      const det = detectMime(buffer, partMime, filename);
      const mime = det.mime;
      const ext = det.ext;
      const mediaType = normalizeMediaType(hintedGlobal, mime, filename);
      const caption = captions[i] ?? fields.caption;

      // Eksekusi kirim dalam antrean (berurutan)
      try {
        await s.queue.push(async () => {
          logger.info({
            sessionId,
            to: jid,
            idx: i,
            mediaType,
            mime,
            filename,
          });
          if (mediaType === "image") {
            await s.sock.sendMessage(jid, {
              image: buffer,
              mimetype: mime,
              caption,
            });
          } else if (mediaType === "video") {
            await s.sock.sendMessage(jid, {
              video: buffer,
              mimetype: mime,
              caption,
            });
          } else if (mediaType === "audio") {
            await s.sock.sendMessage(jid, {
              audio: buffer,
              mimetype: mime,
              ptt: true,
            });
          } else if (mediaType === "document") {
            await s.sock.sendMessage(jid, {
              document: buffer,
              mimetype: mime,
              fileName: filename || `file.${ext || "bin"}`,
            });
          } else if (mediaType === "gif") {
            await s.sock.sendMessage(jid, {
              video: buffer,
              mimetype: mime,
              gifPlayback: true,
              caption,
            });
          } else {
            const e = new Error("Unsupported mediaType");
            e.status = 400;
            throw e;
          }
        });

        results.push({
          index: i,
          ok: true,
          fileName: filename,
          mime,
          ext,
          size: buffer.length,
        });
      } catch (err) {
        results.push({
          index: i,
          ok: false,
          error: err.message || "WA_SEND_FAILED",
        });
      }

      // Delay antar file (kecuali setelah file terakhir)
      if (i < files.length - 1) await sleep(delayMs);
    }

    // Ringkas status global
    const okCount = results.filter((r) => r.ok).length;
    const anyError = results.some((r) => !r.ok);

    res.status(anyError ? 207 : 200).json({
      ok: !anyError,
      data: { sessionId, to: jid, sent: okCount, total: files.length, delayMs },
      results,
    });
  } catch (e) {
    next(e);
  }
});

export default router;

/* -------------------- Helpers -------------------- */

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function clampNumber(n, min, max) {
  if (Number.isNaN(n)) return min;
  return Math.min(Math.max(n, min), max);
}
function toArrayMaybe(v) {
  if (v == null) return [];
  // dukung bentuk: captions=a&captions=b atau captions[]=a&captions[]=b
  if (Array.isArray(v)) return v;
  if (typeof v === "string" && v.startsWith("[")) {
    try {
      const arr = JSON.parse(v);
      return Array.isArray(arr) ? arr : [v];
    } catch {}
  }
  return [String(v)];
}

function jidify(phone) {
  const p = String(phone).replace(/\D/g, "");
  return p.endsWith("@s.whatsapp.net") ? p : `${p}@s.whatsapp.net`;
}

function getBoundary(ct) {
  const m = /boundary=([^;]+)/i.exec(ct);
  if (!m) return null;
  let b = m[1].trim();
  if (b.startsWith('"') && b.endsWith('"')) b = b.slice(1, -1);
  return b;
}

function getHeaderValue(v) {
  if (!v) return "";
  if (Array.isArray(v)) return String(v[0]);
  return String(v);
}

/** Parser multipart — kumpulkan SEMUA file (tiap part yang punya filename) */
function parseMultipartAll(bodyBuf, boundary) {
  const boundaryBuf = Buffer.from(`--${boundary}`);
  const endBoundaryBuf = Buffer.from(`--${boundary}--`);
  const result = { files: [], fields: {} };

  // Cari boundary pembuka
  let pos = bodyBuf.indexOf(boundaryBuf);
  if (pos < 0) return result;
  pos += boundaryBuf.length;

  while (pos < bodyBuf.length) {
    // lewati CRLF
    if (bodyBuf[pos] === 13 && bodyBuf[pos + 1] === 10) pos += 2;

    // end?
    const isEnd = bodyBuf
      .slice(
        pos - boundaryBuf.length,
        pos - boundaryBuf.length + endBoundaryBuf.length
      )
      .equals(endBoundaryBuf);
    if (isEnd) break;

    // header sampai \r\n\r\n
    const headerEnd = bodyBuf.indexOf(Buffer.from("\r\n\r\n"), pos);
    if (headerEnd < 0) break;
    const headerRaw = bodyBuf.slice(pos, headerEnd).toString("utf8");
    const headers = parseHeaders(headerRaw);

    // cari part berikutnya
    let next = bodyBuf.indexOf(boundaryBuf, headerEnd + 4);
    if (next < 0) next = bodyBuf.indexOf(endBoundaryBuf, headerEnd + 4);
    if (next < 0) next = bodyBuf.length;

    let bodyEnd = next - 2;
    if (bodyEnd < headerEnd + 4) bodyEnd = headerEnd + 4;
    const partData = bodyBuf.slice(headerEnd + 4, bodyEnd);

    const disp = parseContentDisposition(
      getHeaderValue(headers["content-disposition"])
    );

    // file or field?
    if (disp?.filename) {
      result.files.push({
        headers,
        data: partData,
        filename: disp.filename,
        partName: disp.name || "file",
        partMime:
          getHeaderValue(headers["content-type"]) || "application/octet-stream",
      });
      if (!result.fields.fileName) result.fields.fileName = disp.filename; // fallback global
    } else if (disp?.name) {
      // text field
      const name = disp.name;
      // dukung fields[] array
      if (name.endsWith("[]")) {
        const key = name.slice(0, -2);
        if (!Array.isArray(result.fields[key])) result.fields[key] = [];
        result.fields[key].push(partData.toString("utf8"));
      } else {
        // jika sudah ada, ubah ke array
        if (result.fields[name] !== undefined) {
          if (!Array.isArray(result.fields[name])) {
            result.fields[name] = [result.fields[name]];
          }
          result.fields[name].push(partData.toString("utf8"));
        } else {
          result.fields[name] = partData.toString("utf8");
        }
      }
    }

    pos = next + boundaryBuf.length;
  }

  return result;
}

function parseHeaders(headerRaw) {
  const lines = headerRaw.split("\r\n");
  const headers = {};
  for (const line of lines) {
    const i = line.indexOf(":");
    if (i > -1) {
      const k = line.slice(0, i).trim().toLowerCase();
      const v = line.slice(i + 1).trim();
      headers[k] = v;
    }
  }
  return headers;
}

function parseContentDisposition(v) {
  if (!v) return null;
  const out = {};
  for (const part of v.split(";")) {
    const [k, rawVal] = part.trim().split("=");
    const key = (k || "").trim().toLowerCase();
    if (!rawVal) continue;
    let val = rawVal.trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (key === "name") out.name = val;
    if (key === "filename") out.filename = val;
  }
  return out;
}

function guessNameFromType(ct) {
  const ext = mimeExtFromType(ct) || "bin";
  return `file.${ext}`;
}
function mimeExtFromType(ct) {
  ct = (ct || "").toLowerCase();
  if (ct.includes("jpeg")) return "jpg";
  if (ct.includes("jpg")) return "jpg";
  if (ct.includes("png")) return "png";
  if (ct.includes("gif")) return "gif";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("mp4")) return "mp4";
  if (ct.includes("ogg")) return "ogg";
  if (ct.includes("mp3")) return "mp3";
  if (ct.includes("pdf")) return "pdf";
  if (ct.includes("octet-stream")) return "bin";
  return null;
}

function detectMime(buffer, headerCT, filename) {
  const byHeader = (headerCT || "").toLowerCase();
  if (byHeader && !byHeader.startsWith("multipart/")) {
    return {
      mime: byHeader,
      ext: mimeExtFromType(byHeader) || extFromName(filename) || "bin",
    };
  }
  const ext = extFromName(filename);
  if (ext) {
    const mime = mimeFromExt(ext) || "application/octet-stream";
    return { mime, ext };
  }
  const magic = magicMime(buffer);
  return {
    mime: magic || "application/octet-stream",
    ext: mimeExtFromType(magic) || "bin",
  };
}

function extFromName(name = "") {
  const m = /\.([A-Za-z0-9]+)$/.exec(String(name));
  return m ? m[1].toLowerCase() : null;
}
function mimeFromExt(ext) {
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "mp4":
      return "video/mp4";
    case "mp3":
      return "audio/mpeg";
    case "ogg":
      return "audio/ogg";
    case "pdf":
      return "application/pdf";
    default:
      return "application/octet-stream";
  }
}
function magicMime(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
    return "image/jpeg";
  if (
    buf
      .slice(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return "image/png";
  if (buf.slice(0, 3).toString("ascii") === "GIF") return "image/gif";
  if (
    buf.slice(0, 4).toString("ascii") === "RIFF" &&
    buf.slice(8, 12).toString("ascii") === "WEBP"
  )
    return "image/webp";
  if (buf.slice(0, 4).toString("ascii") === "%PDF") return "application/pdf";
  if (buf.slice(4, 8).toString("ascii") === "ftyp") return "video/mp4";
  if (buf.slice(0, 4).toString("ascii") === "OggS") return "audio/ogg";
  if (
    buf.slice(0, 3).toString("ascii") === "ID3" ||
    (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)
  )
    return "audio/mpeg";
  return null;
}
function normalizeMediaType(hint, mime, name) {
  if (["image", "video", "audio", "document", "gif"].includes(String(hint)))
    return hint;
  const m = (mime || "").toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  if (m === "application/pdf" || m.startsWith("application/"))
    return "document";
  const ext = extFromName(name || "");
  if (ext === "gif") return "gif";
  return "document";
}
