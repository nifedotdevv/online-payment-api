import { jsonb, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

/**
 * Raw Paystack webhook events. The unique eventKey means each event is
 * stored and processed only once, even if Paystack retries it.
 */
export const webhookEvents = pgTable("webhook_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Unique per event, e.g. `${event}:${data.id}`. */
  eventKey: varchar("event_key", { length: 200 }).notNull().unique(),
  event: varchar("event", { length: 100 }).notNull(),
  reference: varchar("reference", { length: 100 }),
  payload: jsonb("payload").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  error: text("error"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

export type WebhookEvent = typeof webhookEvents.$inferSelect;
export type NewWebhookEvent = typeof webhookEvents.$inferInsert;
