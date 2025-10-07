import express from 'express';
import { apiKeyAuth } from '../middleware/auth.js';
import { getSession } from '../whatsapp/baileysClient.js';

const router = express.Router();
router.use(apiKeyAuth('user'));

router.post('/configure', (req, res) => {
  const { sessionId, url, secret, enabled } = req.body || {};
  const s = getSession(sessionId);
  if (!s) return res.status(404).json({ error: 'Session not found' });
  s.webhook = { url, secret, enabled: enabled !== false };
  res.json({ ok: true, webhook: s.webhook });
});

export default router;
