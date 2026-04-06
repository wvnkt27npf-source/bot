import { Router, type IRouter, type Request, type Response } from "express";
import { db, signalsTable } from "@workspace/db";
import { eq, desc, count } from "drizzle-orm";

const router: IRouter = Router();

router.get("/signals", async (req: Request, res: Response) => {
  const limitRaw = Number(req.query["limit"] ?? 50);
  const offsetRaw = Number(req.query["offset"] ?? 0);
  const limit = isNaN(limitRaw) || limitRaw < 1 ? 50 : Math.min(limitRaw, 200);
  const offset = isNaN(offsetRaw) || offsetRaw < 0 ? 0 : offsetRaw;
  const processedFilter = req.query["processed"];

  let query = db.select().from(signalsTable).$dynamic();
  let countQuery = db.select({ value: count() }).from(signalsTable).$dynamic();

  if (processedFilter === "true") {
    query = query.where(eq(signalsTable.processed, true));
    countQuery = countQuery.where(eq(signalsTable.processed, true));
  } else if (processedFilter === "false") {
    query = query.where(eq(signalsTable.processed, false));
    countQuery = countQuery.where(eq(signalsTable.processed, false));
  }

  const [signals, totalRows] = await Promise.all([
    query.orderBy(desc(signalsTable.createdAt)).limit(limit).offset(offset),
    countQuery,
  ]);

  res.json({
    signals,
    total: totalRows[0]?.value ?? 0,
    limit,
    offset,
  });
});

router.get("/signals/latest", async (_req: Request, res: Response) => {
  const [signal] = await db
    .select()
    .from(signalsTable)
    .where(eq(signalsTable.processed, false))
    .orderBy(desc(signalsTable.createdAt))
    .limit(1);

  res.json({ signal: signal ?? null });
});

router.patch("/signals/:id/processed", async (req: Request, res: Response) => {
  const id = Number(req.params["id"]);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [updated] = await db
    .update(signalsTable)
    .set({ processed: true })
    .where(eq(signalsTable.id, id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Signal not found" });
    return;
  }

  res.json(updated);
});

export default router;
