import { Request, Response, NextFunction } from "express";
import { logger } from "../services/logger.service.js";

export function errorHandler(
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  logger.error("Internal Server Error caught in global middleware:", err);

  // Standardized error response layout keeping external API structure
  const statusCode = err.status || 500;
  return res.status(statusCode).json({
    success: false,
    error: err.message || String(err),
  });
}
