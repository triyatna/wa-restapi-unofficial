# WARest

REST API + UI **multi-session / multi-device / multi-instance** untuk WhatsApp berbasis **Baileys** (ESM).  
Menyediakan pengiriman teks & media, interactive messages (buttons/list/poll), sticker, vCard, GIF, **Webhook** dengan HMAC, rate-limit dinamis, **anti-spam per-recipient** (cooldown), **quota per API-key**, endpoint **binary multipart multi-file**, dan **health metrics** lengkap (CPU/RAM/Disk/Network/Process).

> Tested with **@whiskeysockets/baileys ≥ 6.7.19** (ESM).  
> Node.js **20 LTS** direkomendasikan.

---

## Tabel Isi

- [Fitur Utama](#-fitur-utama)
- [Requirement](#-requirement)
- [Instalasi](#-instalasi)
- [Konfigurasi](#-konfigurasi-env)
- [Menjalankan](#-menjalankan)
- [UI (QR & Kontrol Sesi)](#-ui-qr--kontrol-sesi)
- [Autentikasi & Role](#-autentikasi--role)
- [Webhook (Dua-Arah, HMAC)](#-webhook-dua-arah-hmac)
  - [Header Request](#header-request)
  - [Body Request](#body-request-contoh)
  - [Body Response (Auto-Reply Actions)](#body-response-opsional-untuk-auto-reply)
  - [Verifikasi HMAC](#verifikasi-hmac-contoh-cepat)
  - [Contoh Implementasi Webhook](#-contoh-implementasi-webhook)
- [Endpoints](#-endpoints-ringkas)
- [Contoh cURL](#-contoh-curl)
- [Integrasi Laravel + Vue](#-integrasi-laravel-12--vue)
- [Tips Produksi & Anti-Ban](#-tips-produksi--anti-ban)
- [Troubleshooting](#-troubleshooting)
- [Roadmap](#-roadmap)
- [Credits](#-credits)
- [License](#-license)

---

## ✨ Fitur Utama

- **Arsitektur**

  - ESM full (kompatibel Baileys ESM)
  - Multi-session, multi-instance (Socket.IO rooms utk QR/telemetri)
  - Queue per-session (serialisasi kirim, aman dari race/ban)
  - Role via `X-API-Key` (**admin**/**user**)
  - UI minimal untuk **QR**, manajemen sesi, & uji kirim

- **WhatsApp**

  - Kirim **text** (+mentions)
  - **Media**: image / video / audio(PTT) / document / **GIF** (video `gifPlayback`)
  - **Location**
  - **Buttons** (quick reply), **List**, **Poll** (tidak stabil)
  - **Sticker** (konversi sharp → **WebP 512×512**)
  - **vCard** (single contact)
  - Forward / quoted / raw payload
  - **Webhook dua-arah** (HMAC SHA-256) untuk event/session/inbound & bisa balas **actions** otomatis
  - **Auto-reply test**: “ping” → “pong” (opsional)

- **Keamanan & Kebijakan**

  - Helmet, CORS whitelist
  - HMAC Webhook (verifikasi di backend)
  - **Rate-limit dinamis** (Admin API)
  - **Anti-spam** per recipient (cooldown)
  - **Quota per API-key**
  - Filter **newsletter/broadcast** dari auto-reply & webhook

- **Operasional**
  - Health Probes: `/health`, `/health/live`, `/health/ready`, `/ping`
  - **/health/misc**: CPU, RAM, Disk, Load, Network, Process, Sessions
  - Logging Pino (pretty di dev)
  - Endpoint **multipart multi-file** dgn **delay antar kirim** (anti-spam)
  - **Proxy** opsional (`HTTPS_PROXY`)
  - Persist `credentials/` untuk menjaga sesi

---

## ✅ Requirement

- Minimal **Node.js 20 LTS**
- OS: Linux/Mac/Windows

---

## ⚙️ Instalasi

```bash
cd server_whatsapp
cp .env.example .env
npm i
```

**Windows**: gunakan `cross-env` agar script `NODE_ENV` lintas OS:

```bash
npm i -D cross-env
# package.json:
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

# Proxy (opsional)
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

UI:

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

- Seluruh request butuh authentication `X-API-Key` di header.
- **Admin**: akses semua endpoint termasuk `/api/admin/*`.
- **User**: endpoints pengiriman pesan, session create/inspect, webhook per-session.

---

## 📡 Webhook (Dua-Arah, HMAC)

Server mengirim **event** ke URL kamu (satu/lebih). Kamu boleh **membalas** body JSON berisi **actions** untuk auto-reply (server akan mengeksekusi actions itu dengan delay antar aksi).

### Header Request

- `Content-Type: application/json`
- `X-Webhook-Signature: <hex hmac_sha256(rawBody, secret)>`
- `X-Webhook-Timestamp: <unix_ms>`
- `X-Webhook-Event: <event_name>`
- `X-Event-Id: <ulid/uuid>` (opsional)

### Body Request (contoh)

```json
{
  "event": "message_received",
  "data": {
    "sessionId": "asdasd22",
    "from": "62812xxxx@s.whatsapp.net",
    "chat": "62812xxxx-123@g.us",
    "message": {},
    "text": "ping",
    "isGroup": false,
    "timestamp": 1730942212345
  },
  "ts": 1730942212345
}
```

**Event umum**

- `qr` — `{ sessionId, qr }`
- `session_open` / `session_closed`
- `message_received`
- `message_status` — `{ to, messageId, status }`
- `group_participant_update` — `{ groupId, action:add|remove|promote|demote, number }`

### Body Response (opsional, untuk auto-reply)

```json
{
  "actions": [
    { "type": "text", "to": "{{from}}", "text": "pong" },
    {
      "type": "media",
      "to": "{{from}}",
      "mediaType": "image",
      "url": "https://picsum.photos/400",
      "caption": "random"
    }
  ],
  "delayMs": 1000
}
```

**Actions yang didukung**

- `text` → `{ to, text, mentions?[] }`
- `media` → `{ to, mediaType: image|video|audio|gif, url, caption? }`
- `document` → `{ to, url, filename?, caption? }`
- `location` → `{ to, lat, lng, name?, address? }`
- `sticker` → `{ to, imageUrl|webpUrl }` (auto-convert ke WebP)
- `vcard` → `{ to, contact:{ fullName, org?, phone, email? } }`
- `buttons` / `list` / `poll` → `{ to, message }` (langsung objek pesan) (tidak stabil)
- `forward` / `raw` → `{ to, message }`
- `noop` → tidak melakukan apa-apa

> String dalam actions bisa menggunakan template `{{path}}` (contoh `{{from}}`, `{{data.text}}`).

### Verifikasi HMAC (contoh cepat)

**Laravel middleware**

```php
public function handle($request, Closure $next)
{
    $secret = env('WA_WEBHOOK_SECRET','topsecret');
    $raw = $request->getContent();
    $sig = hash_hmac('sha256',$raw,$secret);
    abort_unless(hash_equals($sig, $request->header('X-Webhook-Signature')), 401);
    return $next($request);
}
```

---

## 🔌 Contoh Implementasi Webhook

### PHP Native

```php
<?php
header('Content-Type: application/json');
$raw = file_get_contents('php://input');
$secret = 'topsecret';
$provided = $_SERVER['HTTP_X_WEBHOOK_SIGNATURE'] ?? '';
if (!hash_equals(hash_hmac('sha256',$raw,$secret), $provided)) {
  http_response_code(401); echo json_encode(['error'=>'invalid signature']); exit;
}
file_put_contents('whatsapp.txt','['.date('Y-m-d H:i:s')."]
".$raw."

",FILE_APPEND);

$payload = json_decode($raw,true);
$data = $payload['data'] ?? [];
$from = $data['from'] ?? '';
$text = trim($data['text'] ?? '');

$actions=[];
switch (strtolower($text)) {
  case 'p': $actions[]=['type'=>'text','to'=>$from,'text'=>'q']; break;
  case 'q': $actions[]=['type'=>'media','to'=>$from,'mediaType'=>'image','url'=>'https://picsum.photos/400','caption'=>'q']; break;
  case 's': $actions[]=['type'=>'document','to'=>$from,'url'=>'https://file-examples.com/storage/fefe3c760763a87999556e8/2017/02/file_example_XLS_10.xls','filename'=>'sample.xls','caption'=>'q']; break;
  case 'ping': $actions[]=['type'=>'text','to'=>$from,'text'=>'pong']; break;
  default: $actions[]=['type'=>'text','to'=>$from,'text'=>'no command found'];
}
echo json_encode(['actions'=>$actions,'delayMs'=>900]);
```

**Group hook (join/leave)**

```php
<?php
header('Content-Type: application/json');
$payload = json_decode(file_get_contents('php://input'), true);
file_put_contents('hookgroup.txt','['.date('Y-m-d H:i:s')."]
".json_encode($payload)."

",FILE_APPEND);

if (($payload['event'] ?? '') === 'group_participant_update') {
  $d = $payload['data'] ?? [];
  $number = $d['number'] ?? '';
  $groupId = $d['groupId'] ?? '';
  $action  = $d['action'] ?? '';
  echo json_encode(['actions'=>[
    ['type'=>'text','to'=>$groupId,'text'=>"Welcome @$number", 'mentions'=>[$number]]
  ]]); exit;
}
echo json_encode(['actions'=>[]]);
```

### Laravel (routes/web.php)

```php
use Illuminate\Support\Facades\Route;
use Illuminate\Http\Request;

Route::post('/wa/webhook', function (Request $req) {
    $raw = $req->getContent();
    $sig = $req->header('X-Webhook-Signature','');
    $secret = env('WA_WEBHOOK_SECRET','topsecret');
    if (!hash_equals(hash_hmac('sha256',$raw,$secret),$sig)) {
        return response()->json(['error'=>'invalid signature'],401);
    }
    $p = json_decode($raw,true);
    $from = $p['data']['from'] ?? '';
    $text = trim($p['data']['text'] ?? '');
    $actions = $text === 'ping'
        ? [ ['type'=>'text','to'=>$from,'text'=>'pong'] ]
        : [ ['type'=>'text','to'=>$from,'text'=>'ok'] ];
    return response()->json(['actions'=>$actions,'delayMs'=>1000]);
});
```

### Node.js (Express)

```js
import express from "express";
import crypto from "crypto";
const app = express();
app.use(express.json({ limit: "1mb" }));
function verify(req, secret) {
  const raw = JSON.stringify(req.body);
  const sig = crypto.createHmac("sha256", secret).update(raw).digest("hex");
  return crypto.timingSafeEqual(
    Buffer.from(sig),
    Buffer.from(req.get("X-Webhook-Signature") || "")
  );
}
app.post("/wa/webhook", (req, res) => {
  if (!verify(req, process.env.WA_WEBHOOK_SECRET || "topsecret"))
    return res.status(401).json({ error: "invalid signature" });
  const from = req.body?.data?.from,
    text = (req.body?.data?.text || "").trim().toLowerCase();
  const actions =
    text === "p"
      ? [{ type: "text", to: from, text: "q" }]
      : [{ type: "text", to: from, text: "ok" }];
  res.json({ actions, delayMs: 900 });
});
app.listen(8080);
```

### Python (FastAPI)

```python
from fastapi import FastAPI, Request, HTTPException
import hmac, hashlib, json
app = FastAPI(); SECRET="topsecret"
@app.post("/wa/webhook")
async def webhook(req: Request):
    raw = await req.body()
    sig = req.headers.get("x-webhook-signature","")
    calc = hmac.new(SECRET.encode(), raw, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, calc): raise HTTPException(401,"invalid signature")
    p = json.loads(raw); data = p.get("data",{}); from_ = data.get("from"); text=(data.get("text") or "").strip().lower()
    actions = [{"type":"text","to":from_,"text":"pong"}] if text=="ping" else [{"type":"text","to":from_,"text":"ok"}]
    return {"actions":actions,"delayMs":1000}
```

---

## 🔗 Endpoints (Ringkas)

> Semua butuh header `X-API-Key`. `to` gunakan nomor (contoh `628xxxxxx`), server akan jidify `@s.whatsapp.net`.

### Sessions

- `GET /api/sessions` — daftar sesi
- `POST /api/sessions` — buat/mulai sesi `{ id?, webhookUrl?, webhookSecret? }`
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

- `POST /api/messages/buttons` (tidak stabil)
  `{ sessionId, to, text, footer?, buttons:[{id,text}] (max 3) }`
- `POST /api/messages/list` (tidak stabil)
  `{ sessionId, to, title, text, footer?, buttonText?, sections[] }`
- `POST /api/messages/poll`  
  `{ sessionId, to, name, options[], selectableCount? }`
- `POST /api/messages/sticker`  
  `{ sessionId, to, imageUrl? | webpUrl? }`
- `POST /api/messages/vcard`  
  `{ sessionId, to, contact:{ fullName, org?, phone, email? } }`
- `POST /api/messages/gif`  
  `{ sessionId, to, videoUrl, caption? }`

### Messages – **Binary Multi-File**

- `POST /api/messages/media/file` (Content-Type: **multipart/form-data**)
  - Field:
    - `sessionId`, `to` (wajib)
    - **file**/**files**/**file1**/… (bisa BANYAK; nama bebas asalkan ada **filename**)
    - `caption` (global), `captions[]` (per-file)
    - `mediaType` (hint global, opsional)
    - `delayMs` (default 1200; min 300; max 10000)
    - `text` (opsional; jika tanpa file, kirim text-only)
- **Raw binary** (1 file)  
  `POST /api/messages/media/file?sessionId&to&mediaType&caption&fileName&delayMs`  
  Body = file buffer; header `Content-Type` sesuai file

> Respons `200 OK` bila semua sukses, atau `207 Multi-Status` dgn detail per-file.

### Webhook config

- `POST /api/webhooks/configure`  
  `{ sessionId, url, secret, enabled }`

### Admin

- `GET /api/admin/config`
- `POST /api/admin/ratelimit` — ubah `windowMs`, `max`
- `POST /api/admin/webhook-default` — set default url/secret

### Health & Metrics

- `GET /health` — ringkas status & sessions
- `GET /health/live` — liveness
- `GET /health/ready` — readiness
- `GET /ping` — `{ pong: true, ts }`
- `GET /health/misc` — statistik lengkap (CPU/RAM/Disk/Load/Network/Process/Sessions)  
  `GET /health/misc?full=1` → sertakan detail network interface

---

## 🧪 Contoh cURL

**Text**

```bash
curl -X POST http://localhost:4000/api/messages/text   -H "Content-Type: application/json" -H "X-API-Key: <KEY>"   -d '{ "sessionId":"my-session-1","to":"6281234567890","text":"Halo @kamu","mentions":["6281234567890"] }'
```

**Media (URL)**

```bash
curl -X POST http://localhost:4000/api/messages/media   -H "Content-Type: application/json" -H "X-API-Key: <KEY>"   -d '{ "sessionId":"my-session-1","to":"62812xxxx","mediaType":"image","mediaUrl":"https://via.placeholder.com/600x400.png","caption":"test" }'
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

**Vue**

- Bisa embed `/ui`, atau bikin komponen QR sendiri yang connect ke **Socket.IO**, join room `sessionId` dan dengarkan event `qr`, `ready`, `closed`.

---

## 🛡️ Tips Produksi & Anti-Ban

- Gunakan **delay** dan **jitter** saat broadcast (multi-file sudah mendukung delay).
- Jangan spam penerima yang sama; manfaatkan **cooldown** per-recipient.
- Kelola batch kecil + jeda acak.
- Jalankan di belakang **Nginx + TLS**.
- **Persist** folder `credentials/`.
- Rotasi `ADMIN_API_KEY`; simpan secret di Secret Manager.
- Pantau **memory/CPU/Disk** via `/health/misc`; gunakan auto-restart (PM2/systemd/docker).

---

## 🐞 Troubleshooting

- **Windows `NODE_ENV` error** → gunakan `cross-env` atau `win-dev`.
- **QR tidak tampil** → di UI, pastikan **Join QR** room yang benar; atau gunakan endpoint `/utils/qr.png?data=...`.
- **Buttons/List/Poll tidak muncul** → perilaku WA Web berubah-ubah dan tidak stabil untuk pesan interaktif ini.
- **429** → hormati `Retry-After`; lihat header quota.
- **Webhook tidak masuk** → cek HMAC, URL, timeout, dan log webhook receiver.

---

## 🙌 Credits

- [Baileys](https://github.com/WhiskeySockets/Baileys) — Socket-based TS/JavaScript API for WhatsApp Web

---

## 📄 License

This package is released under the [MIT License](LICENSE).
