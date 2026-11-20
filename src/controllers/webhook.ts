import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { env } from "../config/env";
import { db } from "../db";
import { webhookEvents } from "../models";
import { settleTransaction } from "../services/payments";
import { ApiError } from "../utils/ApiError";
import { attempt } from "../utils/attempt";

/** Checks the x-paystack-signature header: HMAC-SHA512 of the raw body, keyed with our secret. */
export function isValidPaystackSignature(rawBody: Buffer, header: string | undefined): boolean {
  if (!header || !Buffer.isBuffer(rawBody)) return false;
  const expected = Buffer.from(
    createHmac("sha512", env.paystackSecretKey).update(rawBody).digest("hex"),
  );
  const received = Buffer.from(header);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

class WebhookController {
  /**
   * POST /webhooks/paystack
   * Verifies the signature, stores each charge.success event once, and settles the
   * transaction. Replies 500 if settling fails so Paystack retries.
   */
  handlePaystackWebhook = async (req: Request, res: Response) => {
    if (!isValidPaystackSignature(req.body, req.get("x-paystack-signature"))) {
      throw ApiError.unauthorized("Invalid signature");
    }

    let body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      body = JSON.parse((req.body as Buffer).toString("utf8"));
    } catch {
      throw ApiError.badRequest("Invalid JSON");
    }

    // Only charge.success matters. Acknowledge everything else so Paystack stops retrying.
    const reference = body?.data?.reference;
    const eventId = body?.data?.id;
    if (
      body?.event !== "charge.success" ||
      typeof reference !== "string" ||
      reference.length > 100 ||
      eventId === undefined ||
      eventId === null
    ) {
      res.json({ received: true });
      return;
    }

    // Never store the reusable card token.
    if (body.data.authorization) delete body.data.authorization.authorization_code;

    const eventKey = `charge.success:${eventId}`;
    await db
      .insert(webhookEvents)
      .values({ eventKey, event: body.event, reference, payload: body })
      .onConflictDoNothing({ target: webhookEvents.eventKey });
    const [row] = await db
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.eventKey, eventKey))
      .limit(1);

    // Paystack retried an event we already handled.
    if (row.processedAt) {
      res.json({ received: true });
      return;
    }

    const [err, settled] = await attempt(settleTransaction(reference));
    if (err) {
      console.error(`Webhook ${eventKey} failed to settle ${reference}:`, err);
      await db
        .update(webhookEvents)
        .set({ error: err.message })
        .where(eq(webhookEvents.id, row.id));
      res
        .status(500)
        .json({ error: { code: "INTERNAL_ERROR", message: "Could not process event" } });
      return;
    }

    // Paystack said charge.success, but verify still says not finished (a brief delay on
    // their side). Leave it unprocessed and reply 500 so Paystack retries later.
    if (settled?.status === "pending") {
      await db
        .update(webhookEvents)
        .set({ error: "still pending on verify" })
        .where(eq(webhookEvents.id, row.id));
      res.status(500).json({ error: { code: "NOT_SETTLED", message: "Payment not settled yet" } });
      return;
    }

    await db
      .update(webhookEvents)
      .set({ processedAt: new Date(), error: settled ? null : "unknown reference" })
      .where(eq(webhookEvents.id, row.id));
    res.json({ received: true });
  };
}

const webhookController = new WebhookController();
export default webhookController;
