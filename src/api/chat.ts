import { Router, Request, Response, NextFunction } from "express";
import { createEmbedding } from "../gemini/embed.js";
import { searchKnowledge } from "../vector/search.js";
import { chatWithContext } from "../gemini/chat.js";

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
    // Pass to central error middleware instead of handling locally
    next(error);
  }
});

export default router;
