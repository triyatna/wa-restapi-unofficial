import dotenv from "dotenv";
dotenv.config();

const env = (key, def = "") => process.env[key] ?? def;

export const config = {
  port: Number(env("PORT", 4000)),
  host: env("HOST", "0.0.0.0"),
  env: env("NODE_ENV", "development"),
  adminKey: (env("ADMIN_API_KEY", "changeme-admin-key") || "").trim(),
  userKeys: (env("USER_API_KEYS", "") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  allowedOrigins: (env("ALLOWED_ORIGINS", "") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  webhookDefault: {
    url: env("WEBHOOK_DEFAULT_URL", ""),
    secret: env("WEBHOOK_DEFAULT_SECRET", "supersecret"),
  },
  mysql: {
    host: env("MYSQL_HOST", ""),
    port: Number(env("MYSQL_PORT", "3306")),
    user: env("MYSQL_USER", ""),
    password: env("MYSQL_PASSWORD", ""),
    database: env("MYSQL_DATABASE", ""),
  },
  rateLimit: {
    windowMs: Number(env("RATE_LIMIT_WINDOW_MS", "60000")),
    max: Number(env("RATE_LIMIT_MAX", "120")),
  },
  spam: {
    cooldownMs: Number(env("SPAM_COOLDOWN_MS", "3000")),
    quotaWindowMs: Number(env("QUOTA_WINDOW_MS", "60000")),
    quotaMax: Number(env("QUOTA_MAX", "500")),
  },
  proxy: env("HTTPS_PROXY", "") || null,
  log: {
    pretty: env("LOG_PRETTY", "true") === "true",
    level: env("LOG_LEVEL", "info"),
  },
  autoReply: {
    enabled: env("AUTOREPLY_ENABLED", "false") === "true",
    pingPong: env("AUTOREPLY_PING_PONG", "true") === "true",
  },
};
