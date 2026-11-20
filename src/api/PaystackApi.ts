import { env } from "../config/env";
import { ApiError } from "../utils/ApiError";
import { keysToCamelCase } from "../utils/camelCase";
import { keysToSnakeCase } from "../utils/snakeCase";
import { BaseApi } from "./BaseApi";

export interface InitialisePaymentArgs {
  email: string;
  /** In the smallest unit (kobo for NGN). Must be a positive whole number. */
  amount: number;
  /** Our own reference (transactions.reference). Paystack generates one if left out. */
  reference?: string;
  currency?: string;
  callbackUrl?: string;
  metadata?: {
    name?: string;
    [key: string]: unknown;
  };
}

/** Every Paystack response is wrapped like this. */
interface PaystackResponse<T> {
  status: boolean;
  message: string;
  data: T;
}

/** Raw shape Paystack sends back (snake_case). */
interface InitialisePaymentRawData {
  authorization_url: string;
  access_code: string;
  reference: string;
}

/** What we return to the rest of the app (camelCase). */
export interface InitialisePaymentResult {
  authorizationUrl: string;
  accessCode: string;
  reference: string;
}

/**
 * Status Paystack reports for a transaction. The first five match our
 * transaction_status enum; the rest mean "not finished yet", so treat them as pending.
 */
export type PaystackTransactionStatus =
  "success" | "failed" | "abandoned" | "reversed" | "pending" | "ongoing" | "processing" | "queued";

/** Raw `data` from GET /transaction/verify/:reference (snake_case). Only the fields we use. */
export interface VerifyPaymentRawData {
  id: number;
  status: PaystackTransactionStatus;
  reference: string;
  /** In kobo. Compare it with the amount we stored before marking a payment as paid. */
  amount: number;
  currency: string;
  channel: string;
  gateway_response: string;
  paid_at: string | null;
  created_at: string;
  fees: number | null;
  metadata: Record<string, unknown> | string | null;
  customer: {
    id: number;
    email: string;
    customer_code: string;
    first_name: string | null;
    last_name: string | null;
  };
  /** Card details. We strip `authorization_code` (a reusable card token) before keeping it. */
  authorization?: Record<string, unknown>;
}

/** What verifyPayment returns (camelCase), plus the raw data for transactions.paystackData. */
export interface VerifyPaymentResult {
  id: number;
  status: PaystackTransactionStatus;
  reference: string;
  amount: number;
  currency: string;
  channel: string;
  gatewayResponse: string;
  paidAt: Date | null;
  createdAt: Date;
  fees: number | null;
  metadata: Record<string, unknown> | string | null;
  customer: {
    id: number;
    email: string;
    customerCode: string;
    firstName: string | null;
    lastName: string | null;
  };
  /** Untouched Paystack response data, for auditing. */
  raw: VerifyPaymentRawData;
}

export class PaystackApi extends BaseApi {
  constructor(secretKey = env.paystackSecretKey) {
    super({
      baseUrl: "https://api.paystack.co",
      headers: { Authorization: `Bearer ${secretKey}` },
    });
  }

  async initialisePayment(details: InitialisePaymentArgs): Promise<InitialisePaymentResult> {
    if (!Number.isInteger(details.amount) || details.amount <= 0) {
      throw ApiError.badRequest("Amount must be a positive whole number in kobo");
    }

    const response = await this.post<PaystackResponse<InitialisePaymentRawData>>(
      "/transaction/initialize",
      keysToSnakeCase(details),
    );

    if (!response?.status) {
      throw ApiError.badGateway(response?.message ?? "Paystack could not initialise the payment");
    }

    return keysToCamelCase<InitialisePaymentResult>(response.data);
  }

  /**
   * Asks Paystack for the real status of a payment. Always call this before marking a
   * transaction as paid, and check that `amount` and `currency` match what we stored.
   */
  async verifyPayment(reference: string): Promise<VerifyPaymentResult> {
    if (!reference.trim()) throw ApiError.badRequest("Payment reference is required");

    const response = await this.get<PaystackResponse<VerifyPaymentRawData>>(
      `/transaction/verify/${encodeURIComponent(reference)}`,
    );

    if (!response?.status || !response.data) {
      throw ApiError.badGateway(response?.message ?? "Paystack could not verify the payment");
    }

    // Paystack sends `authorization.authorization_code`, a reusable card token that can
    // charge the card again. Drop it so it never reaches our database or logs.
    const { authorization, ...data } = response.data;
    const raw: VerifyPaymentRawData = authorization
      ? { ...data, authorization: { ...authorization, authorization_code: undefined } }
      : data;

    // Return only the declared fields, not everything Paystack sends.
    return {
      id: raw.id,
      status: raw.status,
      reference: raw.reference,
      amount: raw.amount,
      currency: raw.currency,
      channel: raw.channel,
      gatewayResponse: raw.gateway_response,
      paidAt: raw.paid_at ? new Date(raw.paid_at) : null,
      createdAt: new Date(raw.created_at),
      fees: raw.fees,
      // metadata is our own data, so its keys stay as we sent them.
      metadata: raw.metadata,
      customer: {
        id: raw.customer?.id,
        email: raw.customer?.email,
        customerCode: raw.customer?.customer_code,
        firstName: raw.customer?.first_name ?? null,
        lastName: raw.customer?.last_name ?? null,
      },
      raw,
    };
  }

  /**
   * Paystack errors look like { status: false, message: "..." }. Only 400/422 messages
   * (problems with the donor's input) are passed on; anything else gets a generic message.
   */
  protected override toApiError(status: number, data: unknown): ApiError {
    const message =
      typeof data === "object" && data !== null && "message" in data
        ? String((data as { message: unknown }).message)
        : `Paystack responded with ${status}`;

    // 400/422 usually mean our request was wrong (bad email, amount, etc.).
    if (status === 400 || status === 422) return ApiError.badRequest(message);
    // e.g. 401 means *our* secret key is wrong: a server problem the client shouldn't see.
    return ApiError.badGateway("Payment provider error");
  }
}

const paystackApi = new PaystackApi();
export default paystackApi;
