import { Request, Response, NextFunction } from "express";

/**
 * Standardized global error handling middleware.
 * Formats errors to include structured metadata (ERROR prefix, timestamp, request info, stack, message, and route).
 */
export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  const timestamp = new Date().toISOString();

  const requestInfo = {
    method: req.method,
    headers: req.headers,
    body: req.body,
  };

  const status = err?.status || 500;
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;

  // Standardized response according to the requested schema keys
  return res.status(status).json({
    error: "ERROR",
    timestamp,
    request: requestInfo,
    stack,
    message,
    route: req.originalUrl || req.url,
  });
}
