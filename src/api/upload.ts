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

    const pageCount = (text.match(/\[PAGE:\d+\]/g) || []).length || 1;
    let targetDocId = "";

    // Register or update document in public.documents with 'processing' status
    const { data: existingDoc } = await supabase
      .from("documents")
      .select("id")
      .eq("filename", fileName)
      .maybeSingle();

    if (existingDoc) {
      targetDocId = existingDoc.id;
      await supabase
        .from("documents")
        .update({
          processing_status: "processing",
          total_pages: pageCount,
          extracted_text: text,
          updated_at: new Date().toISOString(),
        })
        .eq("id", targetDocId);
    } else {
      const { data: newDoc, error: insertErr } = await supabase
        .from("documents")
        .insert({
          title: fileName.replace(/\.[^/.]+$/, ""),
          category: "Geral",
          version: "1.0",
          source: "Upload",
          language: "pt-BR",
          filename: fileName,
          file_size: req.file.size,
          mime_type: req.file.mimetype || "application/pdf",
          total_pages: pageCount,
          extracted_text: text,
          processing_status: "processing",
        })
        .select()
        .single();

      if (!insertErr && newDoc) {
        targetDocId = newDoc.id;
      }
    }

    // Immediately respond to HTTP client to prevent HTTP API timeouts
    res.status(202).json({
      success: true,
      message: "Upload recebido / Processando",
      documentId: targetDocId,
      fileName,
      characters: text.length,
      status: "processing",
    });

    // Asynchronously perform chunking, 768-dim embeddings generation, and vector persistence
    (async () => {
      const bgStart = performance.now();
      try {
        const chunks = createChunks(text);
        const embeddings: number[][] = [];

        logger.info(`[BACKGROUND INDEXING] Gerando ${chunks.length} embeddings de 768 dimensões para: ${fileName}`);

        for (const chunk of chunks) {
          embeddings.push(await createEmbedding(chunk));
        }

        const kDocId = await saveKnowledge(fileName, chunks, embeddings);

        // Update processing status to 'completed' only AFTER chunks and embeddings are persisted
        if (targetDocId) {
          await supabase
            .from("documents")
            .update({
              processing_status: "completed",
              total_pages: pageCount,
              updated_at: new Date().toISOString(),
            })
            .eq("id", targetDocId);
        }

        const duration = parseFloat((performance.now() - bgStart).toFixed(2));
        logger.info("[BACKGROUND INDEXING] Indexação concluída com sucesso", {
          filename: fileName,
          duration,
          chunksCount: chunks.length,
        });

        await indexingHistoryService.record({
          document: fileName,
          date: new Date().toISOString(),
          duration: Math.round(duration),
          chunks_count: chunks.length,
          embeddings_count: embeddings.length,
          success: true,
        });
      } catch (err: any) {
        logger.error("[BACKGROUND INDEXING] Falha ao processar e indexar documento", err, { filename: fileName });
        if (targetDocId) {
          await supabase
            .from("documents")
            .update({ processing_status: "failed", updated_at: new Date().toISOString() })
            .eq("id", targetDocId);
        }

        await indexingHistoryService.record({
          document: fileName,
          date: new Date().toISOString(),
          duration: Math.round(performance.now() - bgStart),
          chunks_count: 0,
          embeddings_count: 0,
          success: false,
          error_message: err.message || String(err),
        });
      }
    })();
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
