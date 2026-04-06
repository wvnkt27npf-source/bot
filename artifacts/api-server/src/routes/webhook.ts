import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod/v4";
import { db, signalsTable } from "@workspace/db";

const router: IRouter = Router();

const webhookPayloadSchema = z.object({
  symbol: z.string().min(1),
  action: z.enum(["BUY", "SELL"]),
  price: z.number().optional(),
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

  const authHeader = req.headers["authorization"] ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
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
