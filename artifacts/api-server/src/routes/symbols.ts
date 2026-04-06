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
  { name: "BTCUSD", xmUrl: "https://my.xm.com/symbol-info/BTCUSD%23" },
  { name: "ETHUSD", xmUrl: "https://my.xm.com/symbol-info/ETHUSD%23" },
  { name: "ENJUSD", xmUrl: "https://my.xm.com/symbol-info/ENJUSD%23" },
  { name: "XRPUSD", xmUrl: "https://my.xm.com/symbol-info/XRPUSD%23" },
  { name: "LTCUSD", xmUrl: "https://my.xm.com/symbol-info/LTCUSD%23" },
];

async function ensureDefaultSymbols() {
  const existing = await db.select().from(symbolsTable);
  if (existing.length === 0) {
    await db.insert(symbolsTable).values(DEFAULT_SYMBOLS);
  }
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
