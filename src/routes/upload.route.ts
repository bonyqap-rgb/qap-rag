import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import { readPdf } from "../services/pdf.service.js";
import { createChunks } from "../services/chunker.service.js";
import { createEmbedding } from "../services/embedding.service.js";
import { saveKnowledge } from "../services/vector.service.js";
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
    logger.error("Error during PDF knowledge upload execution:", error);

    // Maintain exact previous error formatting structure
    return res.status(500).json({
      success: false,
      error: error,
    });
  }
});

export default router;
