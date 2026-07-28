import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import { readPdf } from "../pdf/readPdf.js";
import { createChunks } from "../chunker/createChunks.js";
import { createEmbedding } from "../gemini/embed.js";
import { saveKnowledge } from "../services/saveKnowledge.js";

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

    // 1. Parsing robusto de PDF com limpeza e formatação de marcações
    const text = await readPdf(req.file.buffer);

    // 2. Fatiamento inteligente em chunks com conhecimento semântico e tracking de página
    const chunks = createChunks(text);

    const embeddings: number[][] = [];

    console.log(`[UPLOAD] Gerando ${chunks.length} embeddings para o documento: ${req.file.originalname}`);

    // 3. Geração de embeddings com suporte a validação, retentativas e cache interno de duplicatas
    for (const chunk of chunks) {
      embeddings.push(await createEmbedding(chunk));
    }

    // 4. Salvamento unificado com deduplicação de vetores e injeção de metadados
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
    next(error);
  }
});

export default router;
