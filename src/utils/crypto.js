import crypto from 'crypto';

export function hmacSign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

export function safeEqual(a, b) {
  const bufA = Buffer.from(a || '', 'utf8');
  const bufB = Buffer.from(b || '', 'utf8');
  return crypto.timingSafeEqual(
    Buffer.concat([bufA, Buffer.alloc(1)]).subarray(0, Math.max(bufA.length,1)),
    Buffer.concat([bufB, Buffer.alloc(1)]).subarray(0, Math.max(bufB.length,1))
  );
}
