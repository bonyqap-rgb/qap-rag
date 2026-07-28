import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import { readPdf } from "../pdf/readPdf.js";
import { createChunks } from "../chunker/createChunks.js";
import { createEmbedding } from "../gemini/embed.js";
import { saveKnowledge } from "../services/saveKnowledge.js";
import { logger } from "../services/logger.service.js";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
});

router.post("/", upload.single("file"), async (req: Request, res: Response, next: NextFunction) => {
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
    // Pass to central error middleware instead of handling locally
    next(error);
  }
});

export default router;
