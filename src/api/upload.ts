import { Router } from "express";
import multer from "multer";
import { readPdf } from "../pdf/readPdf.js";
import { createChunks } from "../chunker/createChunks.js";
import { createEmbedding } from "../gemini/embed.js";
import { saveKnowledge } from "../services/saveKnowledge.js";

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

    console.log(`Gerando ${chunks.length} embeddings...`);

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
    console.error("=================================");
    console.error(error);

    if (error?.message) console.error(error.message);
    if (error?.details) console.error(error.details);
    if (error?.hint) console.error(error.hint);
    if (error?.code) console.error(error.code);

    console.error("=================================");

    return res.status(500).json({
      success: false,
      error,
    });
  }
});

export default router;