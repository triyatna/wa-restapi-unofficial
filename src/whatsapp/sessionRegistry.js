import fs from "fs";
import path from "path";

const DATA_DIR = path.resolve("data");
const SESS_FILE = path.join(DATA_DIR, "sessions.json");
let registry = { sessions: {} };

export function loadRegistry() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(SESS_FILE)) {
      registry = JSON.parse(fs.readFileSync(SESS_FILE, "utf8"));
      if (!registry.sessions) registry.sessions = {};
    }
  } catch (e) {
    console.error("[sessionRegistry] load error:", e);
  }
}

export function saveRegistry() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SESS_FILE, JSON.stringify(registry, null, 2), "utf8");
  } catch (e) {
    console.error("[sessionRegistry] save error:", e);
  }
}

export function upsertSessionMeta(meta) {
  if (!meta?.id) throw new Error("meta.id required");
  const prev = registry.sessions[meta.id] || {};
  registry.sessions[meta.id] = {
    id: meta.id,
    label: meta.label ?? prev.label ?? meta.id,
    autoStart: meta.autoStart ?? prev.autoStart ?? true,
    webhookUrl: meta.webhookUrl ?? prev.webhookUrl ?? "",
    webhookSecret: meta.webhookSecret ?? prev.webhookSecret ?? "",
    createdAt: prev.createdAt ?? Date.now(),
    ownerId: meta.ownerId ?? prev.ownerId ?? null,
  };
  saveRegistry();
  return registry.sessions[meta.id];
}

export function removeSessionMeta(id) {
  delete registry.sessions[id];
  saveRegistry();
}

export function listSessionMeta() {
  return Object.values(registry.sessions);
}

export function getSessionMeta(id) {
  return registry.sessions[id] || null;
}
