import type { ErrorRequestHandler } from "express";
import { ApiError } from "../utils/ApiError";

/**
 * Register last: app.use(errorHandler).
 * Express 5 forwards errors thrown in async handlers here automatically.
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ApiError) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined && { details: err.details }),
      },
    });
    return;
  }

  // Malformed JSON body from express.json()
  if (err instanceof SyntaxError && "body" in err) {
    res.status(400).json({ error: { code: "INVALID_JSON", message: "Invalid JSON body" } });
    return;
  }

  // Unknown errors: log the full error, but never send internals to the client.
  console.error(err);
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
};
