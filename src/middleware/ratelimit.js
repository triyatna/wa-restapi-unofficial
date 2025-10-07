import NodeCache from 'node-cache';
import { config } from '../config.js';

const cache = new NodeCache({ stdTTL: 0, checkperiod: 60 });

export function dynamicRateLimit() {
  return (req, res, next) => {
    const key = (req.auth?.key) || req.ip;
    const windowMs = config.rateLimit.windowMs;
    const max = config.rateLimit.max;
    const bucketKey = `rl:${key}`;
    let state = cache.get(bucketKey);
    const now = Date.now();
    if (!state || now > state.reset) {
      state = { count: 0, reset: now + windowMs };
    }
    state.count += 1;
    cache.set(bucketKey, state, windowMs / 1000 + 5);
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - state.count)));
    res.setHeader('X-RateLimit-Reset', String(Math.floor(state.reset / 1000)));
    if (state.count > max) return res.status(429).json({ error: 'Too many requests' });
    next();
  };
}
