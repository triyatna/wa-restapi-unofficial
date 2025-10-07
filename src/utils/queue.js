// src/utils/queue.js
export class SimpleQueue {
  constructor() {
    this.q = []; // [{ fn, resolve, reject }]
    this.running = false;
  }
  push(fn) {
    return new Promise((resolve, reject) => {
      this.q.push({ fn, resolve, reject });
      this._run();
    });
  }
  async _run() {
    if (this.running) return;
    this.running = true;
    while (this.q.length) {
      const { fn, resolve, reject } = this.q.shift();
      try {
        const out = await fn();
        resolve(out);
      } catch (e) {
        reject(e); // <-- PENTING: jangan ditelan
      }
    }
    this.running = false;
  }
}
