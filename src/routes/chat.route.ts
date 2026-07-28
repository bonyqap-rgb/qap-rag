import { Router, Request, Response, NextFunction } from "express";
import { createEmbedding } from "../services/embedding.service.js";
import { searchKnowledge } from "../services/vector.service.js";
import { chatWithContext } from "../services/chat.service.js";
import { logger } from "../services/logger.service.js";

const router = Router();

router.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { question } = req.body;

    if (!question) {
      return res.status(400).json({
        success: false,
        error: "Pergunta não informada.",
      });
    }

    // Gera o embedding da pergunta
    const embedding = await createEmbedding(question);

    // Busca os trechos mais relevantes
    const documents = await searchKnowledge(embedding);

    // Monta o contexto
    const context = documents
      .map((doc: { content: string }) => doc.content)
      .join("\n\n");

    // Gera a resposta
    const answer = await chatWithContext(question, context);

    return res.json({
      success: true,
      answer,
      documents: documents.length,
    });
  } catch (error) {
    logger.error("Error during context chat completion request:", error);

    if (error instanceof Error) {
      return res.status(500).json({
        success: false,
        error: error.message,
        stack: error.stack,
      });
    }

    return res.status(500).json({
      success: false,
      error: String(error),
    });
  }
});

export default router;
