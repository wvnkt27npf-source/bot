import { Router, type IRouter, type Request, type Response } from "express";
import { db, symbolsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";

const router: IRouter = Router();

const createSymbolSchema = z.object({
  name: z.string().min(1),
  xmUrl: z.string().url(),
});

const DEFAULT_SYMBOLS = [
  // Crypto (XM uses # suffix for crypto CFDs)
  { name: "BTCUSD",  xmUrl: "https://my.xm.com/symbol-info/BTCUSD%23" },
  { name: "ETHUSD",  xmUrl: "https://my.xm.com/symbol-info/ETHUSD%23" },
  { name: "XRPUSD",  xmUrl: "https://my.xm.com/symbol-info/XRPUSD%23" },
  { name: "LTCUSD",  xmUrl: "https://my.xm.com/symbol-info/LTCUSD%23" },
  { name: "ENJUSD",  xmUrl: "https://my.xm.com/symbol-info/ENJUSD%23" },
  // Major Forex pairs
  { name: "EURUSD",  xmUrl: "https://my.xm.com/symbol-info/EURUSD" },
  { name: "GBPUSD",  xmUrl: "https://my.xm.com/symbol-info/GBPUSD" },
  { name: "USDJPY",  xmUrl: "https://my.xm.com/symbol-info/USDJPY" },
  { name: "USDCHF",  xmUrl: "https://my.xm.com/symbol-info/USDCHF" },
  { name: "AUDUSD",  xmUrl: "https://my.xm.com/symbol-info/AUDUSD" },
  { name: "NZDUSD",  xmUrl: "https://my.xm.com/symbol-info/NZDUSD" },
  { name: "USDCAD",  xmUrl: "https://my.xm.com/symbol-info/USDCAD" },
  // Minor Forex pairs
  { name: "EURGBP",  xmUrl: "https://my.xm.com/symbol-info/EURGBP" },
  { name: "EURJPY",  xmUrl: "https://my.xm.com/symbol-info/EURJPY" },
  { name: "GBPJPY",  xmUrl: "https://my.xm.com/symbol-info/GBPJPY" },
  { name: "AUDCAD",  xmUrl: "https://my.xm.com/symbol-info/AUDCAD" },
  { name: "AUDNZD",  xmUrl: "https://my.xm.com/symbol-info/AUDNZD" },
  { name: "CADJPY",  xmUrl: "https://my.xm.com/symbol-info/CADJPY" },
  { name: "CHFJPY",  xmUrl: "https://my.xm.com/symbol-info/CHFJPY" },
  { name: "EURCHF",  xmUrl: "https://my.xm.com/symbol-info/EURCHF" },
  { name: "EURCAD",  xmUrl: "https://my.xm.com/symbol-info/EURCAD" },
  { name: "EURAUD",  xmUrl: "https://my.xm.com/symbol-info/EURAUD" },
  { name: "EURNZD",  xmUrl: "https://my.xm.com/symbol-info/EURNZD" },
  { name: "GBPAUD",  xmUrl: "https://my.xm.com/symbol-info/GBPAUD" },
  { name: "GBPCAD",  xmUrl: "https://my.xm.com/symbol-info/GBPCAD" },
  { name: "GBPCHF",  xmUrl: "https://my.xm.com/symbol-info/GBPCHF" },
  { name: "GBPNZD",  xmUrl: "https://my.xm.com/symbol-info/GBPNZD" },
  { name: "NZDCAD",  xmUrl: "https://my.xm.com/symbol-info/NZDCAD" },
  { name: "NZDCHF",  xmUrl: "https://my.xm.com/symbol-info/NZDCHF" },
  { name: "NZDJPY",  xmUrl: "https://my.xm.com/symbol-info/NZDJPY" },
];

async function ensureDefaultSymbols() {
  // Always upsert all defaults (onConflictDoNothing skips existing names)
  // so new defaults are added when the server restarts even if the table had data.
  await db.insert(symbolsTable).values(DEFAULT_SYMBOLS).onConflictDoNothing();
}

router.get("/symbols", async (_req: Request, res: Response) => {
  await ensureDefaultSymbols();
  const symbols = await db.select().from(symbolsTable);
  res.json(symbols);
});

router.post("/symbols", async (req: Request, res: Response) => {
  const parsed = createSymbolSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.issues });
    return;
  }

  try {
    const [inserted] = await db
      .insert(symbolsTable)
      .values({ name: parsed.data.name.toUpperCase(), xmUrl: parsed.data.xmUrl })
      .returning();
    res.status(201).json(inserted);
  } catch (err: unknown) {
    const pgCode =
      (err as { cause?: { code?: string } })?.cause?.code ??
      (err as { code?: string })?.code;
    if (pgCode === "23505") {
      res.status(409).json({ error: "Symbol already exists" });
      return;
    }
    throw err;
  }
});

router.delete("/symbols/:id", async (req: Request, res: Response) => {
  const id = Number(req.params["id"]);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [deleted] = await db
    .delete(symbolsTable)
    .where(eq(symbolsTable.id, id))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Symbol not found" });
    return;
  }

  res.json({ deleted: true });
});

export default router;
