# Online Payment API

A donations API built on [Paystack](https://paystack.com). Donors start a payment, pay on Paystack's checkout page, and the API confirms the payment two ways: a **verify** call when the donor is redirected back, and a signed **webhook** from Paystack as a backup.

> This is a practice project. It runs in Paystack **test mode** and has not been hardened for production.

**Stack:** Node 22 · Express 5 · TypeScript · Drizzle ORM · PostgreSQL 17 · Docker Compose

---

## How a donation works

```
 Frontend / client           This API                            Paystack
       │                        │                                   │
  1.   │ POST /payments/initialize ─►                               │
       │                        │ save customer + "pending" row     │
       │                        │ initialize transaction ──────────►│
       │◄── authorizationUrl ───│◄──────────── checkout link ───────│
       │                        │                                   │
  2.   │ donor pays on Paystack's checkout page ───────────────────►│
       │                        │                                   │
  3.   │◄──────────── redirect to PAYSTACK_CALLBACK_URL?reference=… │
       │ GET /payments/verify/:reference ─►                         │
       │                        │ ask Paystack for the real status ►│
       │                        │ check amount + currency, update   │
       │◄── { status: "success" }                                   │
       │                        │                                   │
  4.   │                        │◄── POST /webhooks/paystack (signed)
       │                        │ check signature, dedupe, settle   │
```

Steps 3 and 4 both call the same `settleTransaction()` function, so it doesn't matter which one arrives first. The webhook still marks the donation as paid if the donor closes the tab before the redirect.

### Safety checks

- **The server confirms every payment.** A transaction becomes `success` only after the API asks Paystack directly _and_ the amount and currency match what was saved. A webhook payload alone is never trusted.
- **Webhook signatures are checked.** The API computes an HMAC-SHA512 of the raw request body with the secret key and compares it in constant time. Unsigned or tampered requests get `401`.
- **Retries are safe.** Each webhook event is stored once (unique `event_key`), and updates only apply while a transaction is still `pending`, so a webhook and a verify call at the same moment can't overwrite each other.
- **Card tokens are never stored.** Paystack's reusable `authorization_code` is removed before anything is saved.
- **The redirect address is fixed.** The callback URL comes from server config, not from the request body, so clients can't send donors to another site after they pay.
- **Errors don't leak details.** Unknown errors return a generic `500`, and request logs never include bodies.

---

## Project structure

```
src/
├── index.ts              # Starts the server, graceful shutdown
├── app.ts                # Express app, middleware and routes
├── config/env.ts         # Reads and validates environment variables
├── api/
│   ├── BaseApi.ts        # Small fetch wrapper (timeouts, JSON, error mapping)
│   └── PaystackApi.ts    # initialisePayment, verifyPayment
├── controllers/
│   ├── paystack.ts       # POST /payments/initialize, GET /payments/verify/:reference
│   └── webhook.ts        # POST /webhooks/paystack + signature check
├── services/
│   └── payments.ts       # settleTransaction(): shared by verify and the webhook
├── db/
│   ├── index.ts          # pg Pool + Drizzle client
│   └── utils.ts          # withTransaction, checkDbConnection, closeDb
├── models/               # Drizzle tables: customers, transactions, webhook_events
├── middleware/           # requestLogger, notFound, errorHandler
└── utils/                # ApiError, attempt(), camelCase / snake_case converters
drizzle/                  # Generated SQL migrations
scripts/
└── send-test-webhook.mjs # Sends a signed fake webhook for local testing
```

### Database

| Table            | What it holds                                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `customers`      | One row per donor, matched by email                                                                                                                           |
| `transactions`   | One row per donation attempt. Amount in **kobo**, status `pending` / `success` / `failed` / `abandoned` / `reversed`, plus the Paystack response for auditing |
| `webhook_events` | Every `charge.success` webhook received, with a unique key so retries are handled once                                                                        |

---

## Getting started

### Requirements

- Node.js 22+
- Docker (for Postgres), or your own Postgres 17 instance
- A free [Paystack](https://paystack.com) account (test mode needs no business documents)

### 1. Install

```bash
git clone https://github.com/nifedotdevv/online-payment-api.git
cd online-payment-api
npm install
```

### 2. Configure

```bash
cp .env.example .env
```

Then fill in `.env`:

| Variable                                                       | Required   | Description                                                                                                         |
| -------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                 | Yes        | Postgres connection string (the default matches the Docker DB)                                                      |
| `PAYSTACK_SECRET_KEY`                                          | Yes        | Test secret key (`sk_test_…`), from Paystack Dashboard → Settings → API Keys & Webhooks                             |
| `PAYSTACK_CALLBACK_URL`                                        | No         | Where Paystack sends donors after paying (your thank-you page). Falls back to the callback URL set in the dashboard |
| `PORT`                                                         | No         | API port, default `3000`                                                                                            |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `DB_PORT` | For Docker | Settings for the Postgres container                                                                                 |
| `PGADMIN_EMAIL`, `PGADMIN_PASSWORD`                            | For Docker | Login for pgAdmin at http://localhost:5050                                                                          |

Never commit `.env`. It's already in `.gitignore`.

### 3. Start the database and run migrations

```bash
docker compose up -d db
npm run db:migrate
```

### 4. Run the API

```bash
npm run dev
```

Check it at `GET http://localhost:3000/health`. It should return `{ "status": "ok", "db": "up" }`.

To run everything in Docker instead: `docker compose up --build`.

---

## API

All amounts are in the **smallest currency unit** (kobo for NGN): ₦5,000 = `500000`.
Errors always look like `{ "error": { "code": "…", "message": "…", "details"?: … } }`.

### `POST /payments/initialize`

Starts a donation and returns a Paystack checkout link.

```bash
curl -X POST http://localhost:3000/payments/initialize \
  -H "Content-Type: application/json" \
  -d '{"email":"donor@example.com","amount":500000,"name":"Ada","message":"Keep it up!"}'
```

| Field         | Type    | Required | Notes                                                  |
| ------------- | ------- | -------- | ------------------------------------------------------ |
| `email`       | string  | Yes      | Trimmed and lowercased; used to match the customer     |
| `amount`      | integer | Yes      | Positive whole number in kobo, max `1000000000` (₦10m) |
| `name`        | string  | No       | Up to 100 characters                                   |
| `message`     | string  | No       | Up to 500 characters                                   |
| `isAnonymous` | boolean | No       | Defaults to `false`                                    |

**201 Created**

```json
{
  "data": {
    "reference": "don_0fe0567e-aa14-4065-8f93-19bce2322d2d",
    "authorizationUrl": "https://checkout.paystack.com/…",
    "accessCode": "…"
  }
}
```

Send the donor to `authorizationUrl`.

| Status | When                                                                                      |
| ------ | ----------------------------------------------------------------------------------------- |
| `400`  | Invalid body; `details` lists each field's problem                                        |
| `502`  | Paystack failed (generic message, details are logged); the transaction is marked `failed` |

### `GET /payments/verify/:reference`

Confirms a payment with Paystack and updates the transaction. Call it from the callback page using the `reference` query parameter Paystack adds.

**200 OK**

```json
{
  "data": {
    "reference": "don_…",
    "status": "success",
    "amount": 500000,
    "currency": "NGN",
    "paidAt": "2026-11-20T21:50:45.000Z"
  }
}
```

- If `status` is still `pending`, the donor hasn't finished paying yet.
- A transaction that is already settled is returned straight from the database, without calling Paystack again.
- An unknown reference gets `404`.

### `POST /webhooks/paystack`

Called by Paystack, not by your frontend. Handles `charge.success` and ignores other events.

| Response | When                                                                                            |
| -------- | ----------------------------------------------------------------------------------------------- |
| `401`    | Missing or invalid `x-paystack-signature`                                                       |
| `200`    | Processed, a duplicate, an ignored event type, or an unknown reference                          |
| `500`    | Settling failed, or Paystack doesn't report the payment as finished yet. Paystack retries later |

### `GET /health`

Returns `200 { "status": "ok", "db": "up" }`, or `503` if the database can't be reached.

---

## Testing payments (Paystack test mode)

No real money moves in test mode.

1. Start a donation with the `curl` command above.
2. Open the `authorizationUrl` and pay with Paystack's test card:
   - Card `4084 0840 8408 4081`, CVV `408`, any future expiry date
   - If asked: PIN `0000`, OTP `123456`

   See Paystack's [test payments docs](https://paystack.com/docs/payments/test-payments/) for more cards, including ones that fail.

3. Call `GET /payments/verify/<reference>`. It should return `"status": "success"`.

### Testing the webhook without a tunnel

Send a correctly signed fake `charge.success` to your local API:

```bash
npm run webhook:test -- <reference> [eventId]
npm run webhook:test -- <reference> 1 --bad-signature   # should get 401
```

The API still re-checks the payment with Paystack, so a fake webhook for an unpaid donation leaves it `pending`.

### Receiving real webhooks locally

Paystack can't reach `localhost`, so expose the API with a tunnel:

```bash
cloudflared tunnel --url http://localhost:3000   # or: ngrok http 3000
```

Copy the `https://….trycloudflare.com` address it prints. In the Paystack Dashboard, go to **Settings → API Keys & Webhooks → Test Webhook URL** and enter:

```
https://<your-tunnel-address>/webhooks/paystack
```

Pay a test donation without calling verify. The row should still become `success`, and the event should appear in `webhook_events`.

The tunnel address changes every time you restart it, and your API is public while it runs. Stop it when you're done.

### Looking at the data

```bash
npm run db:studio        # Drizzle Studio
```

Or use pgAdmin at http://localhost:5050.

---

## Scripts

| Command                           | What it does                                    |
| --------------------------------- | ----------------------------------------------- |
| `npm run dev`                     | Start with auto-reload (reads `.env`)           |
| `npm run build`                   | Compile TypeScript to `dist/`                   |
| `npm start`                       | Run the compiled build                          |
| `npm run lint` / `lint:fix`       | ESLint                                          |
| `npm run format` / `format:check` | Prettier                                        |
| `npm run db:generate`             | Create a migration after changing `src/models/` |
| `npm run db:migrate`              | Apply migrations                                |
| `npm run db:studio`               | Browse the database                             |
| `npm run webhook:test`            | Send a signed test webhook                      |

---

## Not included (yet)

- Automated tests
- Rate limiting, CORS configuration and security headers
- Refunds, other webhook events, a donations list endpoint
- Cleanup of old `pending` transactions (marking them `abandoned`)

## License

ISC
