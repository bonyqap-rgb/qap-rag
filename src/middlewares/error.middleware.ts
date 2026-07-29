import { Request, Response, NextFunction } from "express";
import { env } from "../config/env.js";
import { logger } from "../services/logger.service.js";
import { metricsService } from "../services/metrics.service.js";

/**
 * Standardized global error handling middleware with environment awareness (development vs. production).
 */
export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  // Increment error metric
  metricsService.incrementErrors();

  const timestamp = new Date().toISOString();
  const route = req.originalUrl || req.url;
  const status = err?.status || 500;
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;

  // Extract optional request ID from headers if available
  const requestId = (req.headers["x-request-id"] || req.headers["x-correlation-id"]) as string | undefined;

  // 1. Log the full detailed error internally
  logger.error(`[API_ERROR] Caught in global middleware: ${message}`, err, {
    requestId,
    method: req.method,
    route,
    requestBody: req.body,
    requestHeaders: req.headers,
  });

  // 2. Format the client response depending on the NODE_ENV environment
  const isProd = env.NODE_ENV === "production";

  if (isProd) {
    // Production: Hide stack trace and sensitive request headers/bodies to prevent data leak
    return res.status(status).json({
      error: "ERROR",
      timestamp,
      message: status === 500 ? "Internal Server Error" : message,
      route,
      requestId,
    });
  } else {
    // Development: Return full detailed error diagnostics
    return res.status(status).json({
      error: "ERROR",
      timestamp,
      request: {
        method: req.method,
        headers: req.headers,
        body: req.body,
      },
      stack,
      message,
      route,
      requestId,
    });
  }
}
