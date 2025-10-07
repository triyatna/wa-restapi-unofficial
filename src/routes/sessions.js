import express from 'express';
import { apiKeyAuth } from '../middleware/auth.js';
import { dynamicRateLimit } from '../middleware/ratelimit.js';
import { listSessions, createSession, getSession, deleteSession, getQR } from '../whatsapp/baileysClient.js';
import { config } from '../config.js';

const router = express.Router();
router.use(apiKeyAuth('user'), dynamicRateLimit());

router.get('/', (req, res) => res.json({ items: listSessions() }));

router.post('/', async (req, res, next) => {
  try {
    const { id, webhookUrl, webhookSecret } = req.body || {};
    const s = await createSession({ id, socketServer: req.app.get('io'), webhook: { url: webhookUrl || config.webhookDefault.url, secret: webhookSecret || config.webhookDefault.secret } });
    res.json({ id: s.id, status: s.status });
  } catch (e) { next(e); }
});

router.get('/:id', (req, res) => {
  const s = getSession(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  res.json({ id: s.id, status: s.status, me: s.me, qr: getQR(s.id) });
});

router.delete('/:id', async (req, res) => {
  const ok = await deleteSession(req.params.id);
  res.json({ ok });
});

export default router;
