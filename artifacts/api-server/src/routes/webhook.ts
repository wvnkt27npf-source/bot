import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod/v4";
import { db, signalsTable } from "@workspace/db";

const router: IRouter = Router();

const webhookPayloadSchema = z.object({
  symbol: z.string().min(1),
  action: z.string().transform((val) => val.toUpperCase()).pipe(z.enum(["BUY", "SELL"])),
  price: z.number().optional(),
});

// Returns the full webhook URL (with token) so the dashboard can display the correct URL.
// The token is never exposed in the frontend code itself — it comes from the server env.
router.get("/webhook-url", (req: Request, res: Response) => {
  const secret = process.env["WEBHOOK_SECRET"];
  if (!secret) {
    res.json({ url: null, configured: false });
    return;
  }
  const host = req.get("x-forwarded-host") || req.get("host") || "localhost";
  const proto = req.get("x-forwarded-proto") || req.protocol || "https";
  const base = `${proto}://${host}`;
  res.json({ url: `${base}/api/webhook?token=${secret}`, configured: true });
});

router.post("/webhook", async (req: Request, res: Response) => {
  const secret = process.env["WEBHOOK_SECRET"];

  if (!secret) {
    res.status(401).json({
      error: "Webhook not configured",
      message: "Set the WEBHOOK_SECRET environment variable to enable webhook access",
    });
    return;
  }

  // Accept token from Authorization header OR from query param (for TradingView compatibility)
  const authHeader = req.headers["authorization"] ?? "";
  const headerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const queryToken = typeof req.query["token"] === "string" ? req.query["token"] : "";
  const token = headerToken || queryToken;

  if (token !== secret) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = webhookPayloadSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.issues });
    return;
  }

  const { symbol, action, price } = parsed.data;

  const [inserted] = await db
    .insert(signalsTable)
    .values({ symbol: symbol.toUpperCase(), action, price: price ?? null })
    .returning();

  req.log.info({ signalId: inserted.id, symbol, action }, "Webhook signal received");

  res.json({ received: true, signalId: inserted.id });
});

export default router;
