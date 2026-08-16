import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import { readPdf } from "../pdf/readPdf.js";
import { createChunks } from "../chunker/createChunks.js";
import { createEmbedding } from "../gemini/embed.js";
import { saveKnowledge } from "../services/saveKnowledge.js";
import { logger } from "../services/logger.service.js";
import { supabase } from "../config/supabase.js";
import { indexingHistoryService } from "../services/indexing-history.service.js";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
});

router.post("/", upload.single("file"), async (req: Request, res: Response, next: NextFunction) => {
  const start = performance.now();
  const requestId = req.headers["x-request-id"] as string;
  let fileName = "unknown";

  try {
    if (!req.file) {
      const duration = parseFloat((performance.now() - start).toFixed(2));
      logger.warn("[ADMIN] Falha no upload: nenhum arquivo enviado", {
        requestId,
        duration,
        status: "error",
      });

      return res.status(400).json({
        success: false,
        error: "Nenhum arquivo enviado.",
      });
    }

    fileName = req.file.originalname;

    logger.info("[ADMIN] Upload de documento iniciado", {
      requestId,
      filename: fileName,
      fileSize: req.file.size,
    });

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

    // 5. Synchronize public.documents metadata table status
    try {
      const { data: existingDoc } = await supabase
        .from("documents")
        .select("id")
        .eq("filename", req.file.originalname)
        .maybeSingle();

      const pageCount = (text.match(/\[PAGE:\d+\]/g) || []).length || 1;

      if (existingDoc) {
        await supabase
          .from("documents")
          .update({
            processing_status: "completed",
            total_pages: pageCount,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existingDoc.id);
      } else {
        await supabase
          .from("documents")
          .insert({
            title: req.file.originalname.replace(/\.[^/.]+$/, ""),
            category: "Geral",
            version: "1.0",
            source: "Upload",
            language: "pt-BR",
            filename: req.file.originalname,
            file_size: req.file.size,
            mime_type: req.file.mimetype || "application/pdf",
            total_pages: pageCount,
            processing_status: "completed",
          });
      }
    } catch (err: any) {
      logger.warn(`[UPLOAD] Erro ao sincronizar tabela documents: ${err.message || err}`);
    }

    const duration = parseFloat((performance.now() - start).toFixed(2));

    logger.info("[ADMIN] Upload e indexação de documento concluídos com sucesso", {
      requestId,
      duration,
      status: "success",
      filename: fileName,
      chunksCount: chunks.length,
    });

    // Record successful indexing history
    await indexingHistoryService.record({
      document: fileName,
      date: new Date().toISOString(),
      duration: Math.round(duration),
      chunks_count: chunks.length,
      embeddings_count: embeddings.length,
      success: true,
    });

    return res.json({
      success: true,
      documentId,
      fileName: req.file.originalname,
      characters: text.length,
      chunks: chunks.length,
      embeddings: embeddings.length,
    });
  } catch (error: any) {
    const duration = parseFloat((performance.now() - start).toFixed(2));
    logger.error("[ADMIN] Falha no upload/indexação de documento", error, {
      requestId,
      duration,
      status: "error",
      filename: fileName,
    });

    // Record failed indexing history
    await indexingHistoryService.record({
      document: fileName,
      date: new Date().toISOString(),
      duration: Math.round(duration),
      chunks_count: 0,
      embeddings_count: 0,
      success: false,
      error_message: error.message || String(error),
    });

    next(error);
  }
});

export default router;
