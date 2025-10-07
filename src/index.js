import http from "http";
import express from "express";
import { Server } from "socket.io";
import helmet from "helmet";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config } from "./config.js";
import { logger } from "./logger.js";
import { errorHandler } from "./middleware/error.js";

import health from "./routes/health.js";
import admin from "./routes/admin.js";
import sessions from "./routes/sessions.js";
import messages from "./routes/messages.js";
import mediaBinary from "./routes/media-file.js";
import webhooks from "./routes/webhooks.js";
import qr from "./routes/qr.js";

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
    allowedHeaders: ["Content-Type", "X-API-Key"],
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
app.use(
  "/api/messages",
  apiKeyAuth("user"),
  dynamicRateLimit(),
  antiSpam(),
  mediaBinary // route /api/messages/media/file (raw & multipart)
);

// ====== Parser JSON umum ======
app.use(express.json({ limit: "2mb" }));

// ====== Static UI & utils ======
import ui from "./routes/ui.js";
app.use("/ui", ui);
app.use("/utils", qr);

// ====== API lain (pakai JSON) ======
app.use("/health", health);
app.use("/api/admin", admin);
app.use("/api/sessions", sessions);
app.use("/api/messages", messages); // rute /text, /media (via URL), /location, dll.
app.use("/api/webhooks", webhooks);

// error handler terakhir
app.use(errorHandler);

// ====== HTTP + Socket.IO ======
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ORIGINS,
    methods: ["GET", "POST"],
    allowedHeaders: ["X-API-Key"],
  },
});
app.set("io", io);

io.use((socket, next) => {
  const key =
    socket.handshake.auth?.apiKey || socket.handshake.headers["x-api-key"];
  if (!key) return next(new Error("Missing X-API-Key"));
  // TODO: validasi key (admin/user) bila perlu
  next();
});
io.on("connection", (socket) => {
  socket.on("join", ({ room }) => socket.join(room));
});

// Start
server.listen(config.port, config.host, () => {
  logger.info(`WA API listening on http://${config.host}:${config.port}`);
  logger.info(`UI: http://${config.host}:${config.port}/ui`);
});
