import express from 'express';
import { apiKeyAuth } from '../middleware/auth.js';
import { config } from '../config.js';

const router = express.Router();

router.use(apiKeyAuth('admin'));

router.get('/config', (req, res) => {
  res.json({
    rateLimit: config.rateLimit,
    webhookDefault: config.webhookDefault
  });
});

router.post('/ratelimit', (req, res) => {
  const { windowMs, max } = req.body || {};
  if (typeof windowMs === 'number') config.rateLimit.windowMs = windowMs;
  if (typeof max === 'number') config.rateLimit.max = max;
  res.json({ ok: true, rateLimit: config.rateLimit });
});

router.post('/webhook-default', (req, res) => {
  const { url, secret } = req.body || {};
  if (typeof url === 'string') config.webhookDefault.url = url;
  if (typeof secret === 'string') config.webhookDefault.secret = secret;
  res.json({ ok: true, webhookDefault: config.webhookDefault });
});

export default router;
