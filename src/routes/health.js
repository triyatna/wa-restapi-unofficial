import express from "express";
import os from "os";
import process from "process";
import { listSessions, getQR } from "../whatsapp/baileysClient.js";
import { config } from "../config.js";

const router = express.Router();

function deriveStatus() {
  const items = listSessions();
  if (items.length === 0) return { status: "ok", reason: "no-sessions" };
  const anyClosed = items.some((s) =>
    ["closed", "logged_out"].includes(s.status)
  );
  const anyStarting = items.some((s) => s.status === "starting");
  let status = "ok";
  let reason = "all-open-or-idle";
  if (anyClosed) {
    status = "degraded";
    reason = "some-closed";
  } else if (anyStarting) {
    status = "degraded";
    reason = "starting";
  }
  return { status, reason };
}

router.get("/health", (req, res) => {
  const { status, reason } = deriveStatus();
  const sessions = listSessions().map((s) => ({
    id: s.id,
    status: s.status,
    me: s.me,
    pushName: s.pushName,
    lastConn: s.lastConn,
    qr: !!getQR(s.id),
  }));
  res.status(200).json({
    status,
    reason,
    time: new Date().toISOString(),
    uptimeSec: Math.round(process.uptime()),
    memory: process.memoryUsage(),
    loadavg: os.loadavg(),
    env: config.env,
    sessions,
  });
});

router.get("/health/live", (req, res) => res.status(200).json({ live: true }));
router.get("/health/ready", (req, res) => {
  const { status } = deriveStatus();
  res.status(200).json({ ready: true, status });
});
router.get("/ping", (req, res) => res.json({ pong: true, ts: Date.now() }));

export default router;
