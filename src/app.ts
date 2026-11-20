import express from "express";
import webhookController from "./controllers/webhook";
import paystackController from "./controllers/paystack";
import { checkDbConnection } from "./db/utils";
import { errorHandler, notFound, requestLogger } from "./middleware";

export const app = express();

app.disable("x-powered-by");
app.use(requestLogger);
// Must stay above the JSON parser: the signature is computed over the raw body.
app.post(
  "/webhooks/paystack",
  express.raw({ type: "application/json", limit: "100kb" }),
  webhookController.handlePaystackWebhook,
);
app.use(express.json({ limit: "100kb" }));

app.get("/health", async (_req, res) => {
  const dbOk = await checkDbConnection();
  res.status(dbOk ? 200 : 503).json({ status: dbOk ? "ok" : "degraded", db: dbOk ? "up" : "down" });
});

app.post("/payments/initialize", paystackController.initialisePayment);
app.get("/payments/verify/:reference", paystackController.verifyPayment);

app.use(notFound);
app.use(errorHandler);
