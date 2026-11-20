import type { RequestHandler } from "express";
import { ApiError } from "../utils/ApiError";

/** Register after all routes, before errorHandler. */
export const notFound: RequestHandler = (req, _res, next) => {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.path}`));
};
