# server_whatsapp

REST API + UI **multi-session / multi-device / multi-instance** untuk WhatsApp berbasis **Baileys** (ESM).  
Menyediakan pengiriman teks & media, interactive messages, sticker, vCard, GIF, webhook ter‑signing HMAC, rate‑limit dinamis, **anti‑spam per‑recipient** (cooldown), **quota per API‑key**, serta endpoint **binary multipart multi‑file**.

> Tested with **@whiskeysockets/baileys ≥ 6.7.19** (ESM).  
> Node.js **18/20 LTS** direkomendasikan.

---

## ✨ Fitur Utama

- **Arsitektur**

  - ESM full (kompatibel Baileys ESM)
  - Multi-session, multi-instance (Socket.IO rooms untuk QR/telemetri)
  - Queue per-session (serialisasi kirim, aman dari race/ban)
  - Role-based via `X-API-Key` (**admin**/**user**)
  - UI minimal untuk **QR**, manajemen sesi, & uji kirim

- **WhatsApp**

  - Kirim **text** (+mentions)
  - **Media**: image / video / audio(PTT) / document / **GIF** (video `gifPlayback`)
  - **Location**
  - **Buttons** (quick reply), **List**, **Poll**
  - **Sticker** (konversi sharp → **WebP 512×512**)
  - **vCard** (single contact)
  - Forward / quoted / raw payload
  - **Webhook** (HMAC SHA-256) untuk `session_open` & `message_received`
  - **Auto-reply test**: “ping” → “pong” (opsional)

- **Keamanan & Kebijakan**

  - Helmet, CORS whitelist
  - HMAC Webhook (verifikasi di backend)
  - **Rate-limit dinamis** (Admin API)
  - **Anti-spam** per recipient (cooldown)
  - **Quota per API-key**
  - Filter **newsletter/broadcast** dari auto-reply & webhook

- **Operasional**
  - Health (`/health`, `/health/live`, `/health/ready`, `/ping`)
  - Logging Pino (pretty di dev)
  - Endpoint **multipart multi-file** dengan **delay antar-kirim** (anti-spam)
  - **Proxy** opsional (`HTTPS_PROXY`) bila koneksi WAWEB diblokir
  - Persist `credentials/` untuk menjaga sesi

---

## ✅ Requirement

- **Node.js 18/20 LTS** (Node 22 juga ok)
- OS: Linux/Mac/Windows
- **Baileys ESM** `@whiskeysockets/baileys >= 6.7.19`
- (Opsional) MySQL untuk KV settings
- Koneksi internet stabil ke WhatsApp Web

---

## ⚙️ Instalasi

```bash
cd server_whatsapp
cp .env.example .env
npm i
```

**Windows**: gunakan `cross-env` agar script set `NODE_ENV` lintas OS:

```bash
npm i -D cross-env
# lalu di package.json
# "dev": "cross-env NODE_ENV=development node src/index.js"
# "start": "cross-env NODE_ENV=production node src/index.js"
```

---

## 🔧 Konfigurasi `.env`

```env
PORT=4000
HOST=0.0.0.0
NODE_ENV=development

# Auth
ADMIN_API_KEY=changeme-admin-key
USER_API_KEYS=user-key-1,user-key-2

# Webhook default (opsional, bisa override per-session)
WEBHOOK_DEFAULT_URL=
WEBHOOK_DEFAULT_SECRET=supersecret

# Rate limit (global, bisa diubah runtime via Admin API)
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=120

# Anti-spam & Quota (per API key)
SPAM_COOLDOWN_MS=3000
QUOTA_WINDOW_MS=60000
QUOTA_MAX=500

# Auto-reply sederhana
AUTOREPLY_ENABLED=true
AUTOREPLY_PING_PONG=true

# Optional MySQL (untuk KV settings)
MYSQL_HOST=
MYSQL_PORT=3306
MYSQL_USER=
MYSQL_PASSWORD=
MYSQL_DATABASE=whatsapp_api

# Proxy (opsional, jika perlu)
HTTPS_PROXY=

# CORS (UI berbeda origin)
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:8000
```

**MySQL KV (opsional):**

```sql
CREATE TABLE IF NOT EXISTS wa_kv (
  `key` varchar(191) PRIMARY KEY,
  `value` json NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

---

## ▶️ Menjalankan

Dev:

```bash
npm run dev
# Windows: npm run win-dev  (atau gunakan cross-env)
```

Prod:

```bash
npm start
```

Akses UI:

```
http://localhost:4000/ui
```

---

## 🖥️ UI (QR & Kontrol Sesi)

1. Buka `/ui`, set **Base URL** & **X-API-Key** (pakai `ADMIN_API_KEY` untuk full control).
2. **Create/Start** session (boleh tanpa `id` → auto generate).
3. **List Sessions** → pilih → **Join QR** → scan QR (auto refresh).
4. Status berubah `open` → siap kirim.

---

## 🔐 Autentikasi & Role

- Semua request harus menyertakan `X-API-Key`.
- **Admin**: akses semua endpoint termasuk `/api/admin/*`.
- **User**: akses endpoints pengiriman pesan, session create/inspect, webhook per-session.

---

## 🛡️ Keamanan & Anti-Spam

- **HMAC Webhook**:
  - Header `X-Webhook-Signature = HMAC_SHA256(rawBody, secret)`
  - Verifikasi di server penerima (contoh middleware Laravel di bawah).
- **Rate-limit** dinamis (Admin API).
- **Cooldown per-recipient** (hindari spam & ban).
- **Quota per API-key** (window/limit).
- Filter pesan dari `*@newsletter`, `*@broadcast`, `status@broadcast` (tidak diproses webhook/auto-reply).
- Jalankan di belakang **Nginx + HTTPS** untuk produksi.

**Laravel middleware (verifikasi signature):**

```php
public function handle($request, Closure $next)
{
    $secret = env('WA_WEBHOOK_SECRET', 'topsecret');
    $raw = $request->getContent();
    $sig = hash_hmac('sha256', $raw, $secret);
    abort_unless(hash_equals($sig, $request->header('X-Webhook-Signature')), 401, 'Invalid signature');
    return $next($request);
}
```

---

## 🩺 Health & Probes

- `GET /health` → ringkasan: status (`ok|degraded`), sessions, uptime, mem, loadavg.
- `GET /health/live` → liveness OK.
- `GET /health/ready` → readiness + status.
- `GET /ping` → `{ pong: true, ts: ... }`.

---

## 📡 Webhook

Event:

- `session_open` → saat sesi tersambung
- `message_received` → pesan masuk (bukan dari diri sendiri, bukan newsletter/broadcast)

Body:

```json
{
  "event": "message_received",
  "data": { "id": "my-session-1", "message": {} },
  "ts": 1730000000000
}
```

Set default via Admin API, atau per-session via endpoint `POST /api/webhooks/configure`.

---

## 🔗 Endpoints (Ringkas)

> Semua butuh header `X-API-Key`.  
> `to` gunakan MSISDN (contoh `628xxxxxx`), server akan jidify: `@s.whatsapp.net`.

### Sessions

- `GET /api/sessions` — daftar sesi
- `POST /api/sessions` — buat/mulai sesi  
  body: `{ id?, webhookUrl?, webhookSecret? }`
- `GET /api/sessions/:id` — detail sesi
- `DELETE /api/sessions/:id` — hapus sesi

### Messages – dasar

- `POST /api/messages/text`  
  `{ sessionId, to, text, mentions?[] }`
- `POST /api/messages/media` (dengan **mediaUrl**)  
  `{ sessionId, to, caption?, mediaUrl, mediaType: image|video|audio|document }`
- `POST /api/messages/location`  
  `{ sessionId, to, lat, lng, name?, address? }`
- `POST /api/messages/forward`  
  `{ sessionId, to, key?, message }`

### Messages – interaktif & lain

- `POST /api/messages/buttons` (unstable)
  `{ sessionId, to, text, footer?, buttons:[{id,text}] (max 3) }`
- `POST /api/messages/list` (unstable)
  `{ sessionId, to, title, text, footer?, buttonText?, sections[] }`
- `POST /api/messages/poll`  
  `{ sessionId, to, name, options[], selectableCount? }`
- `POST /api/messages/sticker`  
  `{ sessionId, to, imageUrl? | webpUrl? }` → dikonversi ke WebP 512×512
- `POST /api/messages/vcard`  
  `{ sessionId, to, contact:{ fullName, org?, phone, email? } }`
- `POST /api/messages/gif`  
  `{ sessionId, to, videoUrl, caption? }` → video + `gifPlayback:true`

### Messages – **Binary Multi-File**

- `POST /api/messages/media/file` (Content-Type: **multipart/form-data**)
  - Field:
    - `sessionId`, `to` (wajib)
    - **file**/**files**/**file1**/… (bisa BANYAK, nama bebas — asalkan ada **filename**)
    - `caption` (global), `captions[]` (per-file)
    - `mediaType` (hint global, opsional)
    - `delayMs` (opsional; default 1200ms; min 300; max 10000)
    - `text` (opsional; jika tanpa file, kirim text-only)
- **Raw binary** (1 file)  
  `POST /api/messages/media/file?sessionId&to&mediaType&caption&fileName&delayMs`  
  Header `Content-Type` sesuai file; body = file buffer

Respons: `200 OK` bila semua sukses, atau `207 Multi-Status` dengan detail per-file.

### Webhook config

- `POST /api/webhooks/configure`  
  `{ sessionId, url, secret, enabled }`

### Admin

- `GET /api/admin/config` — lihat runtime config
- `POST /api/admin/ratelimit` — ubah `windowMs` & `max`
- `POST /api/admin/webhook-default` — set default url/secret

---

## 🧪 Contoh cURL

**Text**

```bash
curl -X POST http://localhost:4000/api/messages/text  -H "Content-Type: application/json" -H "X-API-Key: <KEY>"  -d '{ "sessionId":"my-session-1","to":"6281234567890","text":"Halo @kamu","mentions":["6281234567890"] }'
```

**Media (URL)**

```bash
curl -X POST http://localhost:4000/api/messages/media  -H "Content-Type: application/json" -H "X-API-Key: <KEY>"  -d '{ "sessionId":"my-session-1","to":"62812xxxx","mediaType":"image","mediaUrl":"https://via.placeholder.com/600x400.png","caption":"test" }'
```

**Multipart multi-file**

```bash
curl -X POST "http://localhost:4000/api/messages/media/file"   -H "X-API-Key: <KEY>"   -F "sessionId=my-session-1"   -F "to=6281234567890"   -F "caption=global caption"   -F "captions[]=gambar 1"   -F "captions[]=video 2"   -F "delayMs=1500"   -F "file=@/path/a.jpg;type=image/jpeg"   -F "file=@/path/b.mp4;type=video/mp4"   -F "files=@/path/c.pdf;type=application/pdf"
```

---

## 🔌 Integrasi Laravel 12 + Vue

**Laravel .env**

```env
WA_API_BASE=http://localhost:4000
WA_API_KEY=changeme-admin-key
```

**Controller (kirim teks)**

```php
use Illuminate\Support\Facades\Http;

public function sendText()
{
    $res = Http::withHeaders([
        'X-API-Key' => env('WA_API_KEY'),
    ])->post(env('WA_API_BASE').'/api/messages/text', [
        'sessionId' => 'my-session-1',
        'to' => '6281234567890',
        'text' => 'Hello from Laravel!',
    ])->json();

    return response()->json($res);
}
```

**Vue (QR UI)**

- Bisa embed `/ui`, atau bangun komponen sendiri yang connect ke **Socket.IO** dan join room `sessionId` untuk event `qr`, `ready`, `closed`.

---

## 🧰 Tips Produksi & Anti-Ban

- Gunakan **delay** dan **jitter** ketika broadcast (endpoint multi-file sudah mendukung delay).
- Jangan spam penerima sama secara beruntun; manfaatkan **cooldown**.
- Kelola batch pengiriman kecil + jeda acak.
- Jalankan di belakang **Nginx + TLS**.
- **Persist** folder `credentials/` (volume Docker / disk).
- Rotasi `ADMIN_API_KEY`, simpan secret di Secret Manager.
- Pantau **memory/CPU** dan gunakan auto-restart (PM2/systemd/docker).

---

## 🐞 Troubleshooting

- **Windows `NODE_ENV` error** → pakai `cross-env` atau `win-dev`.
- **QR tidak muncul** → pastikan di UI **Join QR** room yang benar; gunakan library `qrcode` (canvas) untuk render.
- **Cuma text yang terkirim** → cek antrean `SimpleQueue` (harus me-reject error); periksa log error dari endpoint.
- **Buttons/List/Poll tidak tampil** → behavior WhatsApp Web berubah-ubah; format di repo ini adalah yang paling stabil saat ini. Uji di **mobile app** kalau web tidak menampilkan.
- **429** → lihat header `Retry-After` (cooldown) & `X-Quota-*` (quota).
- **Webhook tidak masuk** → cek HMAC, URL, timeout, dan log server penerima.
- **Newsletter log** → sudah difilter; jika masih terlihat, pastikan patch `isIgnorableJid` aktif.

---

## 🗺️ Roadmap (opsional)

- Interactive **native flow** via `relayMessage` (jika butuh format terbaru)
- Multi-vCard & contact list
- Jadwal/policy anti-ban tingkat lanjut (time-window, backoff adaptif)
- UI Vue 3 full (scan QR, kirim test, monitor queue/limits)

---

## 🙌 Credits

- [Baileys](https://github.com/WhiskeySockets/Baileys) — WhatsApp Web API library (ESM).

---

## 📄 License

**MIT License**
