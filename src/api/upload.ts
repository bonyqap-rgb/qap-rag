import { Router } from "express";
import multer from "multer";
import { readPdf } from "../pdf/readPdf.js";
import { createChunks } from "../chunker/createChunks.js";
import { createEmbedding } from "../gemini/embed.js";
import { saveKnowledge } from "../services/saveKnowledge.js";
import { logger } from "../config/logger.js";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
});

router.post("/", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: "Nenhum arquivo enviado.",
      });
    }

    const text = await readPdf(req.file.buffer);

    const chunks = createChunks(text);

    const embeddings: number[][] = [];

    logger.info(`Gerando ${chunks.length} embeddings...`);

    for (const chunk of chunks) {
      embeddings.push(await createEmbedding(chunk));
    }

    const documentId = await saveKnowledge(
      req.file.originalname,
      chunks,
      embeddings
    );

    return res.json({
      success: true,
      documentId,
      fileName: req.file.originalname,
      characters: text.length,
      chunks: chunks.length,
      embeddings: embeddings.length,
    });
  } catch (error: any) {
    logger.error("Error inside upload route:", error);

    return res.status(500).json({
      success: false,
      error,
    });
  }
});

export default router;
