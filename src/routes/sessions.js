import express from "express";
import { apiKeyAuth } from "../middleware/auth.js";
import { dynamicRateLimit } from "../middleware/ratelimit.js";
import {
  listSessions,
  createSession,
  getSession,
  deleteSession as stopRuntime,
  getQR,
  purgeCreds,
} from "../whatsapp/baileysClient.js";
import {
  removeSessionMeta,
  getSessionMeta,
} from "../whatsapp/sessionRegistry.js";
import { config } from "../config.js";

const router = express.Router();

router.use(apiKeyAuth("user"), dynamicRateLimit());

/**
 * Helper: cek kepemilikan (user boleh hanya miliknya sendiri; admin bebas)
 */
function assertOwnerOrAdmin(req, sessionId) {
  const { role, ownerId } = req.auth || {};
  if (role === "admin") return; // admin lepas
  const meta = getSessionMeta(sessionId);
  if (!meta || meta.ownerId !== ownerId) {
    const msg = !meta ? "Not found" : "Forbidden";
    const code = !meta ? 404 : 403;
    const err = new Error(msg);
    err.status = code;
    throw err;
  }
}

/**
 * GET /api/sessions
 * - admin: lihat semua
 * - user: hanya sesi miliknya
 */
router.get("/", (req, res) => {
  const { role, ownerId } = req.auth || {};
  let items = listSessions();
  if (role !== "admin") {
    items = items.filter((it) => getSessionMeta(it.id)?.ownerId === ownerId);
  }
  return res.json({ items });
});

/**
 * POST /api/sessions
 */
router.post("/", async (req, res, next) => {
  try {
    const { ownerId } = req.auth || {};
    const { id, webhookUrl, webhookSecret, label, autoStart } = req.body || {};

    const s = await createSession({
      id,
      label,
      autoStart,
      ownerId,
      socketServer: req.app.get("io"),
      webhook: {
        url: webhookUrl || config.webhookDefault.url,
        secret: webhookSecret || config.webhookDefault.secret,
      },
    });

    return res.json({ id: s.id, status: s.status });
  } catch (e) {
    return next(e);
  }
});

/**
 * GET /api/sessions/:id
 */
router.get("/:id", (req, res) => {
  try {
    assertOwnerOrAdmin(req, req.params.id);
    const s = getSession(req.params.id);
    if (!s) return res.status(404).json({ error: "Not found" });
    return res.json({ id: s.id, status: s.status, me: s.me, qr: getQR(s.id) });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || "error" });
  }
});

/**
 * DELETE /api/sessions/:id?mode=runtime|creds|meta|all
 * hanya pemilik (atau admin)
 */
router.delete("/:id", async (req, res) => {
  const id = req.params.id;
  const mode = String(req.query.mode || "runtime"); // runtime | creds | meta | all
  const result = { id, mode, steps: {} };

  try {
    assertOwnerOrAdmin(req, id);

    if (mode === "runtime" || mode === "all") {
      result.steps.runtime = await stopRuntime(id); // stop socket + hapus dari Map runtime
    }
    if (mode === "creds" || mode === "all") {
      await purgeCreds(id); // hapus folder credentials/auth_<id>
      result.steps.creds = true;
    }
    if (mode === "meta" || mode === "all") {
      await removeSessionMeta(id); // hapus dari data/sessions.json
      result.steps.meta = true;
    }

    return res.json({ ok: true, ...result });
  } catch (e) {
    const code = e.status || 500;
    return res.status(code).json({
      ok: false,
      error: e?.message || "delete failed",
      ...result,
    });
  }
});

export default router;
