import { Router, Request, Response, NextFunction } from "express";
import { ChatService } from "../services/chat.service.js";
import { validatePayload } from "../middlewares/validation.middleware.js";
import { logger } from "../services/logger.service.js";

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

      // For the generic question "crime militar" (without an explicit reference
      // to another statute), the authoritative source is the Código Penal Militar.
      // Keep the answer intact, but prevent unrelated legal documents from being
      // exposed in the structured references returned to the frontend.
      const normalizedQuestion = question
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
      const explicitlyMentionsOtherDocument = /\b(cf|constituicao|cppm|codigo de processo penal militar|rdpm|regulamento disciplinar|i-2-pm|instrucao)\b/.test(normalizedQuestion);
      const isGenericCrimeMilitarQuestion = /\bcrime militar\b/.test(normalizedQuestion) && !explicitlyMentionsOtherDocument;

      if (isGenericCrimeMilitarQuestion && Array.isArray(chatResult.sources)) {
        chatResult.sources = chatResult.sources.filter((source) =>
          /codigo penal militar/i.test(source.filename || "")
        );
      }

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

export default router;
