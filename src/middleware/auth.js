import crypto from "node:crypto";
import { config } from "../config.js";

export function ownerIdFromKey(key) {
  return crypto
    .createHash("sha256")
    .update(String(key))
    .digest("hex")
    .slice(0, 32);
}

function safeEqual(a, b) {
  const A = Buffer.from(a || "");
  const B = Buffer.from(b || "");
  if (A.length !== B.length) return false;
  try {
    return crypto.timingSafeEqual(A, B);
  } catch {
    return false;
  }
}

function extractApiKey(req) {
  const hAuth = req.headers.authorization || "";
  const bearer = hAuth.startsWith("Bearer ") ? hAuth.slice(7).trim() : "";
  return (
    (req.get("X-API-Key") || req.get("x-api-key") || "").trim() ||
    (req.query.api_key ? String(req.query.api_key).trim() : "") ||
    bearer
  );
}

/** @param {"user"|"admin"} requiredRole */
export function apiKeyAuth(requiredRole = "user") {
  return (req, res, next) => {
    const key = extractApiKey(req);
    if (!key) return res.status(401).json({ error: "Missing X-API-Key" });

    const isAdmin = safeEqual(key, config.adminKey);
    const isUser = config.userKeys.some((k) => safeEqual(key, k));

    if (!isAdmin && !isUser) {
      return res.status(401).json({ error: "Invalid X-API-Key" });
    }

    const role = isAdmin ? "admin" : "user";
    if (requiredRole === "admin" && role !== "admin") {
      return res.status(403).json({ error: "Admin only" });
    }

    req.auth = {
      role,
      key,
      ownerId: role === "user" ? ownerIdFromKey(key) : null,
    };
    res.locals.auth = req.auth;
    next();
  };
}
