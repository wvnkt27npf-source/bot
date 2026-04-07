import { Router } from "express";

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

export default router;
