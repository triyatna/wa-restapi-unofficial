import http from "http";
import express from "express";
import { Server } from "socket.io";
import helmet from "helmet";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

import swaggerUi from "swagger-ui-express";
import YAML from "yaml";

import { config } from "./config.js";
import { logger } from "./logger.js";
import { errorHandler } from "./middleware/error.js";

import { basicAuthGate } from "./middleware/basicAuth.js";

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

// Middlewares
import { apiKeyAuth } from "./middleware/auth.js";
import { dynamicRateLimit } from "./middleware/ratelimit.js";
import { antiSpam } from "./middleware/antispam.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set("logger", logger);

// ====== CORS ======
const ORIGINS = (process.env.ALLOWED_ORIGINS || "http://localhost:4000")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // non-browser / curl
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
        "font-src": ["'self'", "data:"], // penting utk Swagger UI
        "object-src": ["'none'"],
      },
    },
  })
);

// ====== RAW upload router (HARUS sebelum JSON parser) ======
// Endpoint binary/multipart multi-file:
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
app.use("/ui", basicAuthGate({ realm: "WARest UI" }), ui); // serve UI
app.use("/utils", qr); // /utils/qr.png?data=...

// ====== API lain (pakai JSON) ======
app.use("/health", health);
app.use("/api/admin", admin);
app.use("/api/sessions", sessions);
app.use("/api/messages", messages); // /text, /media(url), /location, /buttons, /list, /poll, /sticker, /vcard, /gif, etc.
app.use("/api/webhooks", webhooks);

// ===== OpenAPI /docs =====
const openapiPath = path.join(process.cwd(), "openapi.yaml");
let openapiCache = { mtime: 0, doc: null };

function loadOpenapiCached() {
  const stat = fs.statSync(openapiPath);
  const m = stat.mtimeMs;
  if (!openapiCache.doc || openapiCache.mtime !== m) {
    const raw = fs.readFileSync(openapiPath, "utf8");
    openapiCache.doc = YAML.parse(raw);
    openapiCache.mtime = m;
  }
  return openapiCache.doc;
}

// raw yaml/json (berguna untuk tooling/CI)
app.get(
  "/docs/openapi.yaml",
  basicAuthGate({ realm: "WARest Docs" }),
  (req, res) => {
    res.setHeader("Content-Type", "application/yaml; charset=utf-8");
    fs.createReadStream(openapiPath).pipe(res);
  }
);
app.get(
  "/docs/openapi.json",
  basicAuthGate({ realm: "WARest Docs" }),
  (req, res) => {
    res.json(loadOpenapiCached());
  }
);

// UI di /docs
app.use(
  "/docs",
  basicAuthGate({ realm: "WARest Docs" }),
  swaggerUi.serve,
  swaggerUi.setup(loadOpenapiCached(), {
    explorer: true,
    customSiteTitle: "WARest API Docs",
    swaggerOptions: {
      persistAuthorization: true,
    },
    customCss:
      ".swagger-ui .topbar{display:none}.swagger-ui .info .title{font-weight:800}",
  })
);

// ====== Error handler terakhir ======
app.use(errorHandler);

// ====== HTTP + Socket.IO ======
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

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ORIGINS,
    methods: ["GET", "POST"],
    allowedHeaders: ["X-API-Key", "Authorization"],
  },
});
app.set("io", io);

globalThis.__io = io;

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
    loadRegistry();

    await bootstrapSessions(io);

    server.listen(config.port, config.host, () => {
      logger.info(`WA API listening on http://${config.host}:${config.port}`);
      logger.info(`UI:    http://${config.host}:${config.port}/ui`);
      logger.info(`Docs:  http://${config.host}:${config.port}/docs`);
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
