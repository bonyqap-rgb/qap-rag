import { Request, Response, NextFunction } from "express";

export function requestLogger(
  req: Request,
  _res: Response,
  next: NextFunction
) {
  console.log("====================================");
  console.log(`[REQUEST] ${req.method} ${req.originalUrl}`);
  console.log("Headers:");
  console.log(JSON.stringify(req.headers));
  console.log("====================================");
  next();
}
