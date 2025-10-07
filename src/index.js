// src/index.js
import http from "http";
import express from "express";
import { Server } from "socket.io";
import helmet from "helmet";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config } from "./config.js";
import { logger } from "./logger.js";
// HAPUS salah satu kalau securityMiddleware kamu juga set helmet/cors (jangan dobel)
import { errorHandler } from "./middleware/error.js";

import health from "./routes/health.js";
import admin from "./routes/admin.js";
import sessions from "./routes/sessions.js";
import messages from "./routes/messages.js";
import webhooks from "./routes/webhooks.js";
import qr from "./routes/qr.js";
import ui from "./routes/ui.js";

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

app.use(express.json({ limit: "2mb" }));

// ====== Static UI & utils ======
app.use("/ui", ui); // pastikan ui router men-serve /ui/index.html dan /ui/app.js
app.use("/utils", qr); // /utils/qr.png?data=...

// ====== API ======
app.use("/health", health);
app.use("/api/admin", admin);
app.use("/api/sessions", sessions);
app.use("/api/messages", messages);
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

// >>> AUTH UNTUK SOCKET.IO: gunakan 'auth.apiKey' dari client
io.use((socket, next) => {
  const key =
    socket.handshake.auth?.apiKey || socket.handshake.headers["x-api-key"]; // fallback
  if (!key) return next(new Error("Missing X-API-Key"));
  // TODO: validasi key di sini kalau perlu (admin/user)
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
