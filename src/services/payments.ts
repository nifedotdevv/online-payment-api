import { and, eq } from "drizzle-orm";
import paystackApi, { type PaystackTransactionStatus } from "../api/PaystackApi";
import { db } from "../db";
import { transactions } from "../models";

export type Transaction = typeof transactions.$inferSelect;
type TransactionStatus = Transaction["status"];

/**
 * Maps Paystack's status to ours. Only final states are copied over.
 * Paystack says "abandoned" for any payment not completed *yet* (even one started a
 * second ago), and the donor can still pay it, so it stays pending like "ongoing" etc.
 */
function toTransactionStatus(status: PaystackTransactionStatus): TransactionStatus {
  switch (status) {
    case "success":
    case "failed":
    case "reversed":
      return status;
    default:
      return "pending";
  }
}

/**
 * Asks Paystack for the real status of a payment, checks the amount and currency match
 * what we saved, and updates the transaction. Used by both verify and the webhook.
 * Returns null if no transaction has this reference.
 */
export async function settleTransaction(reference: string): Promise<Transaction | null> {
  const [transaction] = await db
    .select()
    .from(transactions)
    .where(eq(transactions.reference, reference))
    .limit(1);
  if (!transaction) return null;

  // Already settled (by an earlier verify or the webhook): don't ask Paystack again.
  if (transaction.status !== "pending") return transaction;

  const payment = await paystackApi.verifyPayment(reference);
  let status = toTransactionStatus(payment.status);

  // Never trust "success" alone: someone could pay less than they claimed.
  if (
    status === "success" &&
    (payment.amount !== transaction.amount || payment.currency !== transaction.currency)
  ) {
    console.error(
      `Payment ${reference} amount mismatch: expected ${transaction.amount} ${transaction.currency}, ` +
        `got ${payment.amount} ${payment.currency}`,
    );
    status = "failed";
  }

  if (status === "pending") return transaction;

  // Only update while still pending, so two settlers at the same time can't overwrite each other.
  const [updated] = await db
    .update(transactions)
    .set({
      status,
      channel: payment.channel,
      paidAt: status === "success" ? payment.paidAt : null,
      paystackData: payment.raw,
    })
    .where(and(eq(transactions.id, transaction.id), eq(transactions.status, "pending")))
    .returning();

  // updated is undefined if something else settled it first; re-read to return the final state.
  return (
    updated ?? (await db.select().from(transactions).where(eq(transactions.id, transaction.id)))[0]
  );
}
