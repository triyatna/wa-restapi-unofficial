import { config } from '../config.js';

export function apiKeyAuth(requiredRole='user') {
  return (req, res, next) => {
    const key = req.header('X-API-Key') || req.query.api_key;
    if (!key) return res.status(401).json({ error: 'Missing X-API-Key' });
    const isAdmin = key === config.adminKey;
    const isUser = config.userKeys.includes(key);
    if (requiredRole === 'admin' && !isAdmin) return res.status(403).json({ error: 'Admin only' });
    if (!isAdmin && !isUser) return res.status(401).json({ error: 'Invalid API key' });
    req.auth = { role: isAdmin ? 'admin' : 'user', key };
    next();
  };
}
