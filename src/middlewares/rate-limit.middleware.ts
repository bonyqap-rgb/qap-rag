import { rateLimit } from "express-rate-limit";
import { env } from "../config/env.js";

/**
 * Standardized error message formatter for rate limiting.
 */
export function createRateLimitHandler(message: string) {
  return (req: any, res: any) => {
    const timestamp = new Date().toISOString();
    const route = req.originalUrl || req.url;
    const requestId = req.headers["x-request-id"] || req.headers["x-correlation-id"];

    res.status(429).json({
      error: "TOO_MANY_REQUESTS",
      timestamp,
      message,
      route,
      requestId,
    });
  };
}

export const chatRateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX_CHAT,
  standardHeaders: true,
  legacyHeaders: false,
  handler: createRateLimitHandler(
    `Limite de requisições excedido para o chat. Por favor, aguarde antes de tentar novamente.`
  ),
});

export const searchRateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX_SEARCH,
  standardHeaders: true,
  legacyHeaders: false,
  handler: createRateLimitHandler(
    `Limite de requisições excedido para busca semântica. Por favor, aguarde antes de tentar novamente.`
  ),
});

export const indexRateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX_INDEX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: createRateLimitHandler(
    `Limite de requisições excedido para indexação de documentos. Por favor, aguarde antes de tentar novamente.`
  ),
});

export const documentRateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX_CHAT * 2, // 200 requests per 15 mins by default
  standardHeaders: true,
  legacyHeaders: false,
  handler: createRateLimitHandler(
    `Limite de requisições excedido para consulta de documentos. Por favor, aguarde antes de tentar novamente.`
  ),
});
