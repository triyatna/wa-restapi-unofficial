// src/routes/health.js
import express from "express";
import os from "os";
import process from "process";
import { listSessions, getQR } from "../whatsapp/baileysClient.js";
import { config } from "../config.js";
import child_process from "node:child_process";

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

// ⬇️ ganti dari "/health" menjadi "/" karena di-mount di "/health"
router.get("/", (req, res) => {
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

// juga relatif
router.get("/live", (req, res) => res.status(200).json({ live: true }));
router.get("/ready", (req, res) => {
  const { status } = deriveStatus();
  res.status(200).json({ ready: true, status });
});
router.get("/ping", (req, res) => res.json({ pong: true, ts: Date.now() }));

// misc
router.get("/misc", async (req, res) => {
  try {
    const full = req.query.full === "1" || req.query.full === "true";

    const cpus = os.cpus() || [];
    const cpuSummary = {
      count: cpus.length,
      model: cpus[0]?.model || "",
      speedMHz: cpus[0]?.speed || 0,
    };

    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = Math.max(totalMem - freeMem, 0);
    const usedMemPct = totalMem ? +((usedMem / totalMem) * 100).toFixed(2) : 0;

    const loadavg = os.loadavg();

    const pm = process.memoryUsage();
    const proc = {
      pid: process.pid,
      node: process.version,
      uptimeSec: Math.round(process.uptime()),
      memory: {
        rss: pm.rss,
        heapTotal: pm.heapTotal,
        heapUsed: pm.heapUsed,
        external: pm.external,
        arrayBuffers: pm.arrayBuffers ?? 0,
      },
      cpu: process.cpuUsage(),
    };

    const ifaces = os.networkInterfaces() || {};
    const net = Object.entries(ifaces).flatMap(([name, arr]) =>
      (arr || [])
        .filter((a) => !a.internal && a.family === "IPv4")
        .map((a) => ({ iface: name, address: a.address, mac: a.mac }))
    );

    const sessions = listSessions();
    const byStatus = sessions.reduce((acc, s) => {
      acc[s.status] = (acc[s.status] || 0) + 1;
      return acc;
    }, {});
    const sessionsSummary = { total: sessions.length, byStatus };

    const disks = await getDiskUsageSafe();

    const sys = {
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      release: os.release(),
      uptimeSec: Math.round(os.uptime()),
      loadavg,
    };

    const memory = {
      totalBytes: totalMem,
      freeBytes: freeMem,
      usedBytes: usedMem,
      usedPercent: usedMemPct,
    };

    const body = {
      system: sys,
      cpu: cpuSummary,
      memory,
      process: proc,
      disks,
      network: full ? net : undefined,
      sessions: sessionsSummary,
      time: new Date().toISOString(),
    };

    Object.keys(body).forEach((k) => body[k] === undefined && delete body[k]);

    res.json(body);
  } catch (err) {
    res.status(500).json({ error: err.message || "health misc error" });
  }
});
function execCmd(cmd, args, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const p = child_process.spawn(cmd, args, { windowsHide: true });
    let out = "",
      err = "";
    const to = setTimeout(() => {
      try {
        p.kill();
      } catch {}
      reject(new Error("timeout"));
    }, timeoutMs);
    p.stdout.on("data", (d) => (out += d.toString()));
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("error", reject);
    p.on("close", (code) => {
      clearTimeout(to);
      code === 0 ? resolve(out) : reject(new Error(err || `exit ${code}`));
    });
  });
}

async function runPowerShell(script) {
  // Coba 'pwsh' (PowerShell 7) dulu, lalu 'powershell' (Windows PowerShell 5)
  const args = (s) => [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    s,
  ];
  const scripts = [
    ["pwsh", args(script)],
    ["powershell", args(script)],
  ];
  let lastErr;
  for (const [bin, a] of scripts) {
    try {
      return await execCmd(bin, a, 4000);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("powershell not found");
}

function toNum(v) {
  if (v == null) return 0;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  // hilangkan karakter non-digit (koma, spasi, unit)
  const s = String(v).replace(/[^\d.-]/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function stripBom(s) {
  if (typeof s !== "string") return s;
  return s.replace(/^\uFEFF/, "");
}

async function getDiskUsageSafe() {
  const platform = process.platform;
  try {
    if (platform === "win32") {
      // 1) Win32_LogicalDisk (paling akurat)
      try {
        const ps1 =
          `$ErrorActionPreference="Stop"; Get-CimInstance Win32_LogicalDisk | ` +
          `Where-Object { $_.DriveType -in 2,3 } | ` +
          `Select-Object DeviceID, FileSystem, Size, FreeSpace | ConvertTo-Json -Compress`;
        const json1 = stripBom(await runPowerShell(ps1));
        const arr1 = JSON.parse(json1);
        const disks1 = (Array.isArray(arr1) ? arr1 : [arr1])
          .filter(Boolean)
          .map((d) => {
            const size = toNum(d.Size);
            const free = toNum(d.FreeSpace);
            const used = Math.max(size - free, 0);
            const usedPct = size ? +((used / size) * 100).toFixed(2) : 0;
            return {
              mount: d.DeviceID, // "C:"
              fs: d.FileSystem || "",
              sizeBytes: size,
              usedBytes: used,
              freeBytes: free,
              usedPercent: usedPct,
            };
          });
        if (disks1.length) return disks1;
      } catch {}

      // 2) PSDrive fallback
      try {
        const ps2 =
          `$ErrorActionPreference="Stop"; ` +
          `Get-PSDrive -PSProvider FileSystem | ` +
          `Select-Object Name,Used,Free,DisplayRoot | ConvertTo-Json -Compress`;
        const json2 = stripBom(await runPowerShell(ps2));
        let arr2 = JSON.parse(json2);
        if (!Array.isArray(arr2)) arr2 = [arr2];
        const disks2 = arr2
          .filter(Boolean)
          .map((d) => {
            const used = toNum(d.Used);
            const free = toNum(d.Free);
            const size = used + free;
            const usedPct = size ? +((used / size) * 100).toFixed(2) : 0;
            const mount = d.DisplayRoot
              ? String(d.DisplayRoot)
              : d.Name
              ? `${d.Name}:`
              : "";
            return {
              mount,
              fs: "NTFS",
              sizeBytes: size,
              usedBytes: used,
              freeBytes: free,
              usedPercent: usedPct,
            };
          })
          .filter((x) => x.mount); // buang entri aneh
        if (disks2.length) return disks2;
      } catch {}

      // 3) wmic (deprecated, tapi siapa tau ada)
      try {
        const txt = await execCmd(
          "wmic",
          [
            "logicaldisk",
            "get",
            "DeviceID,FreeSpace,Size,FileSystem",
            "/format:csv",
          ],
          4000
        );
        return parseWindowsWmic(txt);
      } catch {}

      // Semua gagal
      return [];
    } else {
      // Unix: df -kP
      const txt = await execCmd("df", ["-kP"], 3000);
      return parseDfK(txt);
    }
  } catch {
    return [];
  }
}

function parseDfK(txt) {
  const lines = stripBom(txt).trim().split(/\r?\n/).slice(1);
  const out = [];
  for (const line of lines) {
    const parts = line.split(/\s+/);
    if (parts.length < 6) continue;
    const fs = parts[0];
    const sizeKB = parseInt(parts[1], 10) || 0;
    const usedKB = parseInt(parts[2], 10) || 0;
    const availKB = parseInt(parts[3], 10) || 0;
    const mount = parts[5];
    const size = sizeKB * 1024;
    const used = usedKB * 1024;
    const free = availKB * 1024;
    const usedPct = size ? +((used / size) * 100).toFixed(2) : 0;
    out.push({
      mount,
      fs,
      sizeBytes: size,
      usedBytes: used,
      freeBytes: free,
      usedPercent: usedPct,
    });
  }
  return out;
}

function parseWindowsWmic(csv) {
  // Node,DeviceID,FileSystem,FreeSpace,Size
  const lines = stripBom(csv).trim().split(/\r?\n/);
  const out = [];
  for (const line of lines.slice(1)) {
    const parts = line.split(",");
    if (parts.length < 5) continue;
    const DeviceID = parts[1];
    const FileSystem = parts[2];
    const FreeSpace = toNum(parts[3]);
    const Size = toNum(parts[4]);
    const Used = Math.max(Size - FreeSpace, 0);
    const usedPct = Size ? +((Used / Size) * 100).toFixed(2) : 0;
    out.push({
      mount: DeviceID,
      fs: FileSystem,
      sizeBytes: Size,
      usedBytes: Used,
      freeBytes: FreeSpace,
      usedPercent: usedPct,
    });
  }
  return out;
}

function parsePowershellDisks(jsonTxt) {
  let arr;
  try {
    arr = JSON.parse(jsonTxt);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) arr = [arr];
  return arr.map((d) => {
    const name = d.Name ? d.Name + ":" : "";
    const used = Number(d.Used) || 0;
    const free = Number(d.Free) || 0;
    const size = used + free;
    const usedPct = size ? +((used / size) * 100).toFixed(2) : 0;
    return {
      mount: name,
      fs: "NTFS",
      sizeBytes: size,
      usedBytes: used,
      freeBytes: free,
      usedPercent: usedPct,
    };
  });
}
export default router;
