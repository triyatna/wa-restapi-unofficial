import NodeCache from 'node-cache';
import { config } from '../config.js';

const cooldown = new NodeCache({ stdTTL: 0, checkperiod: 60 });
const quota = new NodeCache({ stdTTL: 0, checkperiod: 60 });

export function antiSpam() {
  return (req, res, next) => {
    const key = (req.auth?.key) || req.ip;
    const to = (req.body?.to || '').toString();
    const now = Date.now();

    // Per-recipient cooldown by API key
    if (to) {
      const ckey = `cd:${key}:${to}`;
      const until = cooldown.get(ckey);
      if (until && now < until) {
        const retryAfter = Math.max(0, Math.ceil((until - now) / 1000));
        res.setHeader('Retry-After', retryAfter);
        return res.status(429).json({ error: 'Recipient cooldown', retryAfter });
      }
      cooldown.set(ckey, now + config.spam.cooldownMs, config.spam.cooldownMs/1000 + 5);
    }

    // Per-API-key quota window
    const qkey = `q:${key}`;
    let state = quota.get(qkey);
    if (!state || now > state.reset) state = { count: 0, reset: now + config.spam.quotaWindowMs };
    state.count += 1;
    quota.set(qkey, state, config.spam.quotaWindowMs/1000 + 5);
    res.setHeader('X-Quota-Limit', String(config.spam.quotaMax));
    res.setHeader('X-Quota-Remaining', String(Math.max(0, config.spam.quotaMax - state.count)));
    res.setHeader('X-Quota-Reset', String(Math.floor(state.reset/1000)));
    if (state.count > config.spam.quotaMax) {
      return res.status(429).json({ error: 'Quota exceeded' });
    }
    next();
  };
}
