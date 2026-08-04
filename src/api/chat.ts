import { Router, Request, Response, NextFunction } from "express";
import { ChatService } from "../services/chat.service.js";
import { validatePayload } from "../middlewares/validation.middleware.js";
import { logger } from "../services/logger.service.js";
import { env } from "../config/env.js";

const router = Router();

/**
 * POST /chat
 * Receives a message, queries semantic context, and gets LLM answer.
 */
router.post(
  "/",
  validatePayload({
    message: "string",
    question: "string",
    temperature: "number",
    topK: "number",
    maxContextSize: "number",
    timeout: "number",
    model: "string",
    scoreThreshold: "number",
    filters: "object",
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    const start = performance.now();
    const requestId = req.headers["x-request-id"] as string;

    try {
      const question = req.body.message || req.body.question;

      if (!question || typeof question !== "string" || question.trim() === "") {
        const duration = parseFloat((performance.now() - start).toFixed(2));
        logger.warn("[ADMIN] Falha na validação do chat: message vazia", {
          requestId,
          duration,
          status: "error",
        });

        return res.status(400).json({
          success: false,
          error: "O campo 'message' é obrigatório e deve ser uma string não vazia.",
        });
      }

      const { temperature, topK, maxContextSize, timeout, model, scoreThreshold, filters } = req.body;

      const chatResult = await ChatService.chat(question, {
        temperature,
        topK,
        maxContextSize,
        timeout,
        model,
        scoreThreshold,
        filters,
      });

      const duration = parseFloat((performance.now() - start).toFixed(2));
      logger.info("[ADMIN] Chat executado com sucesso", {
        requestId,
        duration,
        status: "success",
        question: "[REDACTED]",
      });

      return res.json(chatResult);
    } catch (error) {
      const duration = parseFloat((performance.now() - start).toFixed(2));
      logger.error("[ADMIN] Falha ao executar chat", error, {
        requestId,
        duration,
        status: "error",
      });
      next(error);
    }
  }
);

/**
 * POST /chat/diagnose
 * Diagnostic endpoint for RAG pipeline. Enabled only in non-production environments.
 */
router.post(
  "/diagnose",
  validatePayload({
    message: "string",
    question: "string",
    temperature: "number",
    topK: "number",
    maxContextSize: "number",
    timeout: "number",
    model: "string",
    scoreThreshold: "number",
    filters: "object",
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    const start = performance.now();
    const requestId = req.headers["x-request-id"] as string;

    // Restriction to development/test environments only
    if (process.env.NODE_ENV === "production") {
      return res.status(403).json({
        success: false,
        error: "O endpoint de diagnóstico está disponível apenas no ambiente de desenvolvimento.",
      });
    }

    try {
      const question = req.body.message || req.body.question;

      if (!question || typeof question !== "string" || question.trim() === "") {
        return res.status(400).json({
          success: false,
          error: "O campo 'message' ou 'question' é obrigatório e deve ser uma string não vazia.",
        });
      }

      const { temperature, topK, maxContextSize, timeout, model, scoreThreshold, filters } = req.body;

      const diagnosticResult = await ChatService.diagnose(question, {
        temperature,
        topK,
        maxContextSize,
        timeout,
        model,
        scoreThreshold,
        filters,
      });

      const duration = parseFloat((performance.now() - start).toFixed(2));
      logger.info("[ADMIN] Diagnóstico do chat executado com sucesso", {
        requestId,
        duration,
        status: "success",
      });

      return res.json(diagnosticResult);
    } catch (error) {
      const duration = parseFloat((performance.now() - start).toFixed(2));
      logger.error("[ADMIN] Falha ao executar diagnóstico do chat", error, {
        requestId,
        duration,
        status: "error",
      });
      next(error);
    }
  }
);

export default router;
