import { sql } from "drizzle-orm";
import { db, pool } from "./index";

/** The `tx` object Drizzle passes into db.transaction callbacks. */
export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Runs `fn` in a transaction. Commits if it resolves, rolls back if it throws.
 *
 *   await withTransaction(async (tx) => {
 *     await tx.update(transactions).set({ status: "success" }).where(...);
 *     await tx.update(webhookEvents).set({ processedAt: new Date() }).where(...);
 *   });
 */
export function withTransaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(fn);
}

/** Returns true if the database answers. Handy for a deeper /health check. */
export async function checkDbConnection(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch (err) {
    console.error("Database connection check failed:", err);
    return false;
  }
}

/** Closes the pool. Call on shutdown (SIGTERM) so connections are released cleanly. */
export function closeDb(): Promise<void> {
  return pool.end();
}
