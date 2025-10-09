import crypto from "node:crypto";

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

function parseAuthEnv(raw) {
  // format: "user:pass,user2:pass2"
  const map = new Map();
  (String(raw || "").split(",") || []).forEach((pair) => {
    const s = pair.trim();
    if (!s) return;
    const idx = s.indexOf(":");
    if (idx < 0) return;
    const user = s.slice(0, idx);
    const pass = s.slice(idx + 1);
    if (user) map.set(user, pass);
  });
  return map;
}

/**
 * Gate Basic Auth untuk route tertentu (UI/Docs).
 * Env: AUTHENTICATION atau authentication => "user:pass,user2:pass2"
 * Opsi:
 *   - realm: string untuk WWW-Authenticate
 */
export function basicAuthGate(opts = {}) {
  const realm = opts.realm || "WARest Access";
  const raw = process.env.AUTHENTICATION ?? process.env.authentication ?? "";
  const users = parseAuthEnv(raw);

  if (users.size === 0) {
    return (_req, _res, next) => next();
  }

  return (req, res, next) => {
    try {
      // Format header: Authorization: Basic base64(user:pass)
      const hdr = req.headers.authorization || "";
      const [scheme, b64] = hdr.split(" ");
      if (scheme !== "Basic" || !b64) {
        res.setHeader("WWW-Authenticate", `Basic realm="${realm}"`);
        return res.status(401).end("Authentication required");
      }

      let user = "";
      let pass = "";
      try {
        const decoded = Buffer.from(b64, "base64").toString("utf8");
        const i = decoded.indexOf(":");
        if (i >= 0) {
          user = decoded.slice(0, i);
          pass = decoded.slice(i + 1);
        }
      } catch {}

      if (!users.has(user)) {
        res.setHeader("WWW-Authenticate", `Basic realm="${realm}"`);
        return res.status(401).end("Unauthorized");
      }

      const expected = users.get(user);
      if (!safeEqual(pass, expected)) {
        res.setHeader("WWW-Authenticate", `Basic realm="${realm}"`);
        return res.status(401).end("Unauthorized");
      }

      return next();
    } catch {
      res.setHeader("WWW-Authenticate", `Basic realm="${realm}"`);
      return res.status(401).end("Unauthorized");
    }
  };
}
