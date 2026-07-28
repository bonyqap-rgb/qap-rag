import { Request, Response, NextFunction } from "express";
import { logger } from "../services/logger.service.js";

export function requestLogger(
  req: Request,
  _res: Response,
  next: NextFunction
) {
  logger.info("====================================");
  logger.info(`${req.method} ${req.originalUrl}`);
  logger.info("Headers:", req.headers as any);
  logger.info("====================================");
  next();
}
