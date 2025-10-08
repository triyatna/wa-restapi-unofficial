import http from "http";
import express from "express";
import { Server } from "socket.io";
import helmet from "helmet";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";

import crypto from "node:crypto";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { errorHandler } from "./middleware/error.js";

// Routes
import health from "./routes/health.js";
import admin from "./routes/admin.js";
import sessions from "./routes/sessions.js";
import messages from "./routes/messages.js";
import mediaBinary from "./routes/media-file.js";
import webhooks from "./routes/webhooks.js";
import qr from "./routes/qr.js";
import ui from "./routes/ui.js";

// Registry & sessions bootstrap
import { loadRegistry } from "./whatsapp/sessionRegistry.js";
import { bootstrapSessions } from "./whatsapp/baileysClient.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set("logger", logger);

// ====== CORS ======
const ORIGINS = (process.env.ALLOWED_ORIGINS || "http://localhost:4000")
  .split(",")
  .map((s) => s.trim());

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error("CORS not allowed: " + origin), false);
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-API-Key", "Authorization"],
    maxAge: 86400,
  })
);
app.options("*", cors());

// ====== Helmet CSP ======
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'", "'unsafe-inline'"],
        "script-src": ["'self'", "'unsafe-inline'"],
        "connect-src": ["'self'", "ws:", "wss:", ...ORIGINS],
        "img-src": ["'self'", "data:", "blob:"],
        "style-src": ["'self'", "'unsafe-inline'"],
        "object-src": ["'none'"],
      },
    },
  })
);

// ====== RAW upload router HARUS sebelum json parser ======
import { apiKeyAuth } from "./middleware/auth.js";
import { dynamicRateLimit } from "./middleware/ratelimit.js";
import { antiSpam } from "./middleware/antispam.js";

// Endpoint binary/multipart multi-file:
//   /api/messages/media/file (raw & multipart)
// diproteksi auth/ratelimit/antispam sama seperti messages lain.
app.use(
  "/api/messages",
  apiKeyAuth("user"),
  dynamicRateLimit(),
  antiSpam(),
  mediaBinary
);

// ====== Parser JSON umum ======
app.use(express.json({ limit: "2mb" }));

// ====== Static UI & utils ======
app.use("/ui", ui); // serve UI
app.use("/utils", qr); // /utils/qr.png?data=...

// ====== API lain (pakai JSON) ======
app.use("/health", health);
app.use("/api/admin", admin);
app.use("/api/sessions", sessions);
app.use("/api/messages", messages); // /text, /media(url), /location, /buttons, /list, /poll, /sticker, /vcard, /gif, etc.
app.use("/api/webhooks", webhooks);

// ====== Error handler terakhir ======
app.use(errorHandler);
function roleFromKey(key) {
  if (!key) return null;
  if (key === config.adminKey) return "admin";
  if (config.userKeys && config.userKeys.includes(key)) return "user";
  return null;
}
// ====== HTTP + Socket.IO ======
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ORIGINS,
    methods: ["GET", "POST"],
    allowedHeaders: ["X-API-Key", "Authorization"],
  },
});
app.set("io", io);

// buat global reference agar modul lain (mis. baileysClient) bisa emit event tanpa circular dep
globalThis.__io = io;

function safeEqual(a, b) {
  const A = Buffer.from(String(a || ""));
  const B = Buffer.from(String(b || ""));
  if (A.length !== B.length) return false;
  try {
    return crypto.timingSafeEqual(A, B);
  } catch {
    return false;
  }
}

io.use((socket, next) => {
  try {
    const rawAuth = socket.handshake.auth?.apiKey;
    const rawHdr = socket.handshake.headers["x-api-key"];
    const key = String(rawAuth || rawHdr || "").trim();

    if (!key) {
      const err = new Error("Missing X-API-Key");
      err.data = { code: 401, message: "Missing X-API-Key" };
      return next(err);
    }

    const isAdmin = safeEqual(key, config.adminKey);
    const isUser = (config.userKeys || []).some((k) => safeEqual(key, k));

    if (!isAdmin && !isUser) {
      const err = new Error("Unauthorized");
      err.data = { code: 401, message: "Invalid X-API-Key" };
      return next(err);
    }

    socket.data.role = isAdmin ? "admin" : "user";
    socket.data.apiKey = key;
    return next();
  } catch {
    const err = new Error("Unauthorized");
    err.data = { code: 401, message: "Invalid X-API-Key" };
    return next(err);
  }
});

io.on("connection", (socket) => {
  socket.emit("welcome", { role: socket.data.role });
  socket.on("join", ({ room }) => socket.join(room));
});

// ====== BOOTSTRAP ======
(async () => {
  try {
    // load registry dari disk
    loadRegistry();

    // autostart semua sessions yg autoStart=true (pake kredensial di credentials/)
    await bootstrapSessions(io);

    // // Jika belum punya bootstrapSessions(), pakai fallback:
    // const metas = listSessionMeta();
    // for (const m of metas) {
    //   if (m.autoStart === false) continue;
    //   await startSession({ id: m.id, webhookUrl: m.webhookUrl, webhookSecret: m.webhookSecret })
    //     .catch(e => logger.error(e, "[autostart] failed " + m.id));
    // }

    // start server
    server.listen(config.port, config.host, () => {
      logger.info(`WA API listening on http://${config.host}:${config.port}`);
      logger.info(`UI: http://${config.host}:${config.port}/ui`);
    });
  } catch (e) {
    logger.error(e, "Fatal during bootstrap");
    process.exit(1);
  }
})();

const shutdown = (signal) => {
  return () => {
    logger.info(`${signal} received, shutting down...`);
    try {
      io?.close?.();
      server?.close?.(() => {
        logger.info("HTTP server closed");
        process.exit(0);
      });
      setTimeout(() => process.exit(0), 3000).unref();
    } catch {
      process.exit(0);
    }
  };
};
process.on("SIGINT", shutdown("SIGINT"));
process.on("SIGTERM", shutdown("SIGTERM"));
