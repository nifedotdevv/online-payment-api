import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { customers } from "./customer";

export const transactionStatus = pgEnum("transaction_status", [
  "pending",
  "success",
  "failed",
  "abandoned",
  "reversed",
]);

/** One donation attempt. Amounts are in the smallest unit (kobo for NGN). */
export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Our unique reference, sent to Paystack and used to verify. */
    reference: varchar("reference", { length: 100 }).notNull().unique(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    amount: integer("amount").notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("NGN"),
    status: transactionStatus("status").notNull().default("pending"),

    // Donation details
    message: text("message"),
    isAnonymous: boolean("is_anonymous").notNull().default(false),

    // Paystack details, filled after verification
    paystackAccessCode: varchar("paystack_access_code", { length: 100 }),
    channel: varchar("channel", { length: 50 }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    /** Raw verify response, for auditing. */
    paystackData: jsonb("paystack_data"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("transactions_customer_id_idx").on(t.customerId),
    index("transactions_status_idx").on(t.status),
    check("transactions_amount_positive", sql`${t.amount} > 0`),
  ],
);

export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
