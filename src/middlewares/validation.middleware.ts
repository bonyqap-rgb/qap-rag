import { Request, Response, NextFunction } from "express";

/**
 * Sanitises strings by escaping potentially dangerous characters to prevent injection/HTML-based attacks.
 */
export function sanitizeInput(text: string): string {
  if (typeof text !== "string") return text;
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .replace(/\//g, "&#x2F;");
}

/**
 * Validates request payload schemas and applies input sanitisation.
 */
export function validatePayload(schema: { [key: string]: "string" | "number" | "boolean" | "object" | "any" }) {
  return (req: Request, res: Response, next: NextFunction) => {
    const timestamp = new Date().toISOString();
    const route = req.originalUrl || req.url;
    const requestId = req.headers["x-request-id"];

    for (const [key, type] of Object.entries(schema)) {
      const val = req.body[key];

      // Missing optional fields (like filters, topK) are fine as long as not strictly required elsewhere
      if (val === undefined) continue;

      if (type !== "any" && typeof val !== type) {
        return res.status(400).json({
          error: "BAD_REQUEST",
          timestamp,
          message: `O campo '${key}' deve ser do tipo '${type}'.`,
          route,
          requestId,
        });
      }

      // Sanitise strings in-place
      if (type === "string" && typeof val === "string") {
        req.body[key] = sanitizeInput(val);
      }
    }

    next();
  };
}
