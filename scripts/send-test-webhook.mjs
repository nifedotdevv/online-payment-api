// Sends a signed fake charge.success webhook to the local API.
// Usage: node --env-file=.env scripts/send-test-webhook.mjs <reference> [eventId] [--bad-signature]
import { createHmac } from "node:crypto";

const args = process.argv.slice(2);
const badSignature = args.includes("--bad-signature");
const [reference, eventId] = args.filter((a) => !a.startsWith("--"));

if (!reference) {
  console.error("Usage: send-test-webhook.mjs <reference> [eventId] [--bad-signature]");
  process.exit(1);
}
const secret = process.env.PAYSTACK_SECRET_KEY;
if (!secret) {
  console.error("PAYSTACK_SECRET_KEY is not set (run with --env-file=.env)");
  process.exit(1);
}

const body = JSON.stringify({
  event: "charge.success",
  data: { id: Number(eventId ?? Date.now()), reference, status: "success" },
});
let signature = createHmac("sha512", secret).update(body).digest("hex");
if (badSignature) signature = signature.replace(/^./, (c) => (c === "0" ? "1" : "0"));

const url = process.env.WEBHOOK_URL ?? "http://localhost:3000/webhooks/paystack";
const res = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-paystack-signature": signature },
  body,
});
console.log(res.status, await res.text());
