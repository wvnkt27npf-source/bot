import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const symbolsTable = pgTable("symbols", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  xmUrl: text("xm_url").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSymbolSchema = createInsertSchema(symbolsTable).omit({ id: true, createdAt: true });
export type InsertSymbol = z.infer<typeof insertSymbolSchema>;
export type SymbolRecord = typeof symbolsTable.$inferSelect;
