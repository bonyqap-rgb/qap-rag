import { Request, Response, NextFunction } from "express";

export function errorHandler(
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  console.error("=================================");
  console.error("[API ERROR CAUGHT]:", err);
  if (err?.message) console.error(err.message);
  if (err?.details) console.error(err.details);
  if (err?.hint) console.error(err.hint);
  if (err?.code) console.error(err.code);
  console.error("=================================");

  // Determine standard response structure matching previous upload and chat schemas
  const errorObj = err instanceof Error ? err.message : err;

  // Preserve status code if set, otherwise default to 500
  const statusCode = err?.status || 500;

  return res.status(statusCode).json({
    success: false,
    error: errorObj,
  });
}
