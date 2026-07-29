import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { logger } from "../services/logger.service.js";

/**
 * Standard HTTP Request structured logger middleware.
 * Generates unique requestId (if not provided), tracks duration, status, and formats cleanly in JSON.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = performance.now();

  // Ensure requestId exists
  const requestId = (req.headers["x-request-id"] || req.headers["x-correlation-id"] || crypto.randomUUID()) as string;
  req.headers["x-request-id"] = requestId;
  res.setHeader("x-request-id", requestId);

  // We capture response finished event to log status and duration
  res.on("finish", () => {
    const duration = parseFloat((performance.now() - start).toFixed(2));

    // Safety check: Sanitise potential prompt / answer in body/query or log purely meta
    // Never log full prompts, full answers or API keys!
    const queryMeta = req.query ? { ...req.query } : {};
    const bodyMeta = req.body ? { ...req.body } : {};

    // Omit sensitive data fields from log
    const sensitiveFields = [
      "message", "question", "query", "answer", "text", "contents", "content",
      "apiKey", "api_key", "password", "token", "file", "buffer"
    ];

    for (const f of sensitiveFields) {
      if (f in queryMeta) queryMeta[f] = "[REDACTED_FOR_SECURITY]";
      if (f in bodyMeta) bodyMeta[f] = "[REDACTED_FOR_SECURITY]";
    }

    logger.info(`[HTTP] ${req.method} ${req.originalUrl || req.url} - ${res.statusCode} (${duration}ms)`, {
      requestId,
      method: req.method,
      route: req.originalUrl || req.url,
      statusCode: res.statusCode,
      durationMs: duration,
      query: Object.keys(queryMeta).length > 0 ? queryMeta : undefined,
      body: Object.keys(bodyMeta).length > 0 ? bodyMeta : undefined,
    });
  });

  next();
}
