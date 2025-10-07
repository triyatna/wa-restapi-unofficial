import axios from 'axios';
import { hmacSign } from '../utils/crypto.js';
import { logger } from '../logger.js';

export async function postWebhook({ url, secret, event, payload }) {
  if (!url) return;
  try {
    const body = { event, data: payload, ts: Date.now() };
    const json = JSON.stringify(body);
    const sig = hmacSign(json, secret || '');
    await axios.post(url, body, {
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': sig
      },
      timeout: 10000
    });
  } catch (err) {
    logger.warn({ err: err?.response?.data || err.message }, 'Webhook failed');
  }
}
