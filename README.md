# Detopupin WhatsApp Remote API (Baileys)

Production-grade, multi-session/multi-instance REST API with a minimal UI, built on top of [Baileys](https://baileys.wiki/).

## Highlights
- Multi-session & multi-instance (rooms via Socket.IO, per-session queues)
- REST API + static UI console
- Roles via API Keys: **admin** & **user**
- Dynamic rate limiting, basic anti-spam, webhook (HMAC SHA-256), health endpoints
- Pluggable storage: filesystem by default, optional MySQL KV
- Ready to integrate with **Laravel 12 + Vue Starter Kits** via simple HTTP calls

## Quick Start
```bash
cp .env.example .env
npm i
npm run dev     # or: npm start
# UI at: http://localhost:4000/ui
```
Use `ADMIN_API_KEY` from `.env` as **X-API-Key** in UI and REST calls.

## REST Endpoints (Essential)
- `GET /health` → status
- `GET /api/sessions` (auth: user/admin)
- `POST /api/sessions` body: `{ id?, webhookUrl?, webhookSecret? }`
- `GET /api/sessions/:id`
- `DELETE /api/sessions/:id`
- `POST /api/messages/text` body: `{ sessionId, to, text, mentions? }`
- `POST /api/messages/media` body: `{ sessionId, to, caption?, mediaUrl, mediaType: image|video|audio|document }`
- `POST /api/messages/location` body: `{ sessionId, to, lat, lng, name?, address? }`
- `POST /api/webhooks/configure` body: `{ sessionId, url, secret, enabled }`

Admin-only:
- `GET /api/admin/config`
- `POST /api/admin/ratelimit` → `{ windowMs?, max? }`
- `POST /api/admin/webhook-default` → `{ url?, secret? }`

## Webhook
- Header: `X-Webhook-Signature: HMAC_SHA256(body, secret)`
- Body: `{ event, data, ts }`
- Events: `session_open`, `message_received`

## Notes
- This is a solid base; extend routes to support buttons, lists, polls, stickers, vCards, etc. using Baileys message types.
- For production: run behind a reverse proxy (nginx), enable HTTPS, persist `credentials/` volume, and set real `ADMIN_API_KEY`.


## New Messaging Endpoints
- `POST /api/messages/buttons` `{ sessionId, to, text, footer?, buttons: [{id?, text}] }`
- `POST /api/messages/list` `{ sessionId, to, title, text, footer?, buttonText?, sections: [{ title, rows: [{ id, title, description? }] }] }`
- `POST /api/messages/poll` `{ sessionId, to, name, options: [], selectableCount? }`
- `POST /api/messages/sticker` `{ sessionId, to, imageUrl|webpUrl, author?, pack? }`
- `POST /api/messages/vcard` `{ sessionId, to, contact: { fullName, org?, phone, email? } }`
- `POST /api/messages/gif` `{ sessionId, to, videoUrl, caption? }`

## Anti-Spam & Quota
- Per-recipient cooldown (`SPAM_COOLDOWN_MS`, default 3000ms)
- Per-API-key quota window (`QUOTA_WINDOW_MS`, `QUOTA_MAX`)
- Headers: `X-Quota-*`, `Retry-After` on cooldown

## Auto Reply (Testing)
- Enable via `.env`: `AUTOREPLY_ENABLED=true`
- Ping-pong rule: if user sends "ping", bot replies "pong"
