import { Router, type IRouter, type Request, type Response } from "express";
import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";

const router: IRouter = Router();

const updateSettingsSchema = z.object({
  tpAmount: z.number().positive().optional(),
  slAmount: z.number().positive().optional(),
  automationEnabled: z.boolean().optional(),
});

async function getOrCreateSettings() {
  const [existing] = await db.select().from(settingsTable).limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(settingsTable)
    .values({ tpAmount: 2.0, slAmount: 2.0, automationEnabled: true })
    .returning();
  return created;
}

router.get("/settings", async (_req: Request, res: Response) => {
  const settings = await getOrCreateSettings();
  res.json(settings);
});

router.patch("/settings", async (req: Request, res: Response) => {
  const parsed = updateSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.issues });
    return;
  }

  const updates: Partial<typeof settingsTable.$inferInsert> = {};
  if (parsed.data.tpAmount !== undefined) updates.tpAmount = parsed.data.tpAmount;
  if (parsed.data.slAmount !== undefined) updates.slAmount = parsed.data.slAmount;
  if (parsed.data.automationEnabled !== undefined) updates.automationEnabled = parsed.data.automationEnabled;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No fields to update provided" });
    return;
  }

  const settings = await getOrCreateSettings();

  const [updated] = await db
    .update(settingsTable)
    .set(updates)
    .where(eq(settingsTable.id, settings.id))
    .returning();

  res.json(updated);
});

export default router;
