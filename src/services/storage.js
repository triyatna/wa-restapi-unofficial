import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import { logger } from '../logger.js';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const baseDir = path.resolve(__dirname, '../../credentials');
if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });

export class Storage {
  constructor() {
    this.mysqlPool = null;
    if (config.mysql.host && config.mysql.user && config.mysql.database) {
      this.mysqlPool = mysql.createPool({
        host: config.mysql.host,
        port: config.mysql.port,
        user: config.mysql.user,
        password: config.mysql.password,
        database: config.mysql.database,
        connectionLimit: 5,
        waitForConnections: true
      });
      logger.info('Storage: MySQL pool initialized');
    } else {
      logger.info('Storage: Filesystem mode');
    }
  }

  // ---- Generic KV ----
  async getKV(key, def = null) {
    if (this.mysqlPool) {
      const [rows] = await this.mysqlPool.query('SELECT `value` FROM wa_kv WHERE `key`=? LIMIT 1', [key]);
      if (rows.length) return JSON.parse(rows[0].value);
      return def;
    } else {
      const fp = path.join(baseDir, 'kv.json');
      if (!fs.existsSync(fp)) return def;
      const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
      return key in data ? data[key] : def;
    }
  }

  async setKV(key, val) {
    if (this.mysqlPool) {
      const str = JSON.stringify(val);
      await this.mysqlPool.query('INSERT INTO wa_kv (`key`,`value`) VALUES (?,?) ON DUPLICATE KEY UPDATE `value`=VALUES(`value`)', [key, str]);
    } else {
      const fp = path.join(baseDir, 'kv.json');
      const data = fs.existsSync(fp) ? JSON.parse(fs.readFileSync(fp, 'utf8')) : {};
      data[key] = val;
      fs.writeFileSync(fp, JSON.stringify(data, null, 2));
    }
  }

  // ---- Session state blobs ----
  sessionPath(id) { return path.join(baseDir, `${id}.json`); }

  async getSessionState(id) {
    const fp = this.sessionPath(id);
    if (!fs.existsSync(fp)) return null;
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  }

  async setSessionState(id, state) {
    const fp = this.sessionPath(id);
    fs.writeFileSync(fp, JSON.stringify(state ?? {}, null, 2));
  }

  async deleteSessionState(id) {
    const fp = this.sessionPath(id);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }
}
