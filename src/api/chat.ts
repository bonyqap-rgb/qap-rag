import { Router, Request, Response, NextFunction } from "express";
import { ChatService } from "../services/chat.service.js";
import { validatePayload } from "../middlewares/validation.middleware.js";

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
    try {
      const question = req.body.message || req.body.question;

      if (!question || typeof question !== "string" || question.trim() === "") {
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

      return res.json(chatResult);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
