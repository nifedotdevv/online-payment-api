import { pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

/** A donor. Created on first donation, matched by email. */
export const customers = pgTable("customers", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: text("name"),
  paystackCustomerCode: varchar("paystack_customer_code", { length: 64 }).unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;
