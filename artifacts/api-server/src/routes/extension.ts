import { Router } from "express";
import path from "path";
import fs from "fs";

const router = Router();

let lastHeartbeat: number | null = null;
const CONNECTED_THRESHOLD_MS = 15_000; // 15 seconds

router.post("/extension/heartbeat", (_req, res) => {
  lastHeartbeat = Date.now();
  res.json({ ok: true });
});

router.get("/extension/status", (_req, res) => {
  const connected = lastHeartbeat !== null && Date.now() - lastHeartbeat < CONNECTED_THRESHOLD_MS;
  res.json({ connected, lastHeartbeat });
});

router.get("/extension/download", (_req, res) => {
  // process.cwd() = artifacts/api-server/ when run via pnpm filter
  // so ../trading-dashboard resolves correctly
  const zipPath = path.resolve(process.cwd(), "../trading-dashboard/public/chrome-extension.zip");
  if (!fs.existsSync(zipPath)) {
    return res.status(404).json({ error: "Extension ZIP not found", cwd: process.cwd(), tried: zipPath });
  }
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", 'attachment; filename="algox-trader-extension.zip"');
  res.sendFile(zipPath);
});

export default router;
