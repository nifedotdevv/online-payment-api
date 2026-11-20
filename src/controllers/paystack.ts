import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { eq, sql } from "drizzle-orm";
import paystackApi, { type InitialisePaymentArgs } from "../api/PaystackApi";
import { db } from "../db";
import { withTransaction } from "../db/utils";
import { customers, transactions } from "../models";
import { env } from "../config/env";
import { settleTransaction } from "../services/payments";
import { ApiError } from "../utils/ApiError";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** ₦10,000,000 in kobo. Also keeps amounts inside the integer column's range. */
const MAX_AMOUNT = 1_000_000_000;

/** Checks the request body and returns clean values, or throws a 400 listing every problem. */
function parseInitialiseBody(body: unknown) {
  const { amount, email, name, message, isAnonymous } = (body ?? {}) as Record<string, unknown>;
  const errors: Record<string, string> = {};

  if (typeof email !== "string" || !EMAIL_PATTERN.test(email.trim())) {
    errors.email = "A valid email is required";
  }
  if (
    typeof amount !== "number" ||
    !Number.isInteger(amount) ||
    amount <= 0 ||
    amount > MAX_AMOUNT
  ) {
    errors.amount =
      "Amount must be a positive whole number in kobo, up to 1000000000 (e.g. 500000 for ₦5,000)";
  }
  if (name !== undefined && (typeof name !== "string" || name.trim().length > 100)) {
    errors.name = "Name must be text, up to 100 characters";
  }
  if (message !== undefined && (typeof message !== "string" || message.length > 500)) {
    errors.message = "Message must be text, up to 500 characters";
  }
  if (isAnonymous !== undefined && typeof isAnonymous !== "boolean") {
    errors.isAnonymous = "isAnonymous must be true or false";
  }

  if (Object.keys(errors).length > 0) throw ApiError.badRequest("Invalid payment details", errors);

  return {
    email: (email as string).trim().toLowerCase(),
    amount: amount as number,
    name: (name as string | undefined)?.trim() || undefined,
    message: (message as string | undefined)?.trim() || undefined,
    isAnonymous: (isAnonymous as boolean | undefined) ?? false,
  };
}

class PaystackController {
  /**
   * POST /payments/initialize
   * Saves the donor and a pending transaction, asks Paystack for a payment link,
   * and returns it. The client then sends the donor to `authorizationUrl`.
   */
  initialisePayment = async (req: Request, res: Response) => {
    const { amount, email, name, message, isAnonymous } = parseInitialiseBody(req.body);
    const reference = `don_${randomUUID()}`;

    // Save customer + pending transaction together, before calling Paystack,
    // so the webhook/verify step always finds a matching row.
    const transaction = await withTransaction(async (tx) => {
      const [customer] = await tx
        .insert(customers)
        .values({ email, name })
        .onConflictDoUpdate({
          target: customers.email,
          // Only fill in a missing name. Never overwrite an existing one: anyone who
          // knows a donor's email could otherwise change it.
          set: { name: sql`coalesce(${customers.name}, excluded.name)`, updatedAt: new Date() },
        })
        .returning({ id: customers.id });

      const [created] = await tx
        .insert(transactions)
        .values({ reference, customerId: customer.id, amount, message, isAnonymous })
        .returning({ id: transactions.id });
      return created;
    });

    const paymentDetails: InitialisePaymentArgs = {
      amount,
      email,
      reference,
      callbackUrl: env.paystackCallbackUrl,
      metadata: { name, transactionId: transaction.id },
    };

    try {
      const payment = await paystackApi.initialisePayment(paymentDetails);

      await db
        .update(transactions)
        .set({ paystackAccessCode: payment.accessCode })
        .where(eq(transactions.id, transaction.id));

      res.status(201).json({
        data: {
          reference: payment.reference,
          authorizationUrl: payment.authorizationUrl,
          accessCode: payment.accessCode,
        },
      });
    } catch (err) {
      // Paystack never created this payment, so it can't be paid. Mark it and pass the error on.
      await db
        .update(transactions)
        .set({ status: "failed" })
        .where(eq(transactions.id, transaction.id))
        .catch((updateErr) => console.error("Could not mark transaction failed:", updateErr));
      throw err;
    }
  };

  /**
   * GET /payments/verify/:reference
   * Called after Paystack redirects the donor back. Settles the transaction
   * (see settleTransaction) and returns its public status.
   */
  verifyPayment = async (req: Request<{ reference: string }>, res: Response) => {
    const { reference } = req.params;
    if (!reference || reference.length > 100) throw ApiError.badRequest("Invalid reference");

    const transaction = await settleTransaction(reference);
    if (!transaction) throw ApiError.notFound("Payment not found");

    res.json({ data: toPublicPayment(transaction) });
  };
}

/** Only what the donor's browser needs. Never send paystackData or customer details. */
function toPublicPayment(t: typeof transactions.$inferSelect) {
  return {
    reference: t.reference,
    status: t.status,
    amount: t.amount,
    currency: t.currency,
    paidAt: t.paidAt,
  };
}

const paystackController = new PaystackController();
export default paystackController;
