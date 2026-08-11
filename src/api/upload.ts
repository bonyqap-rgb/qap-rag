import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import fs from "fs/promises";
import path from "path";
import { readPdf } from "../pdf/readPdf.js";
import { createChunks } from "../chunker/createChunks.js";
import { createEmbeddingsForChunks } from "../groq/embed.js";
import { saveKnowledge } from "../services/saveKnowledge.js";
import { logger } from "../services/logger.service.js";
import { indexingHistoryService } from "../services/indexing-history.service.js";
import { supabase } from "../config/supabase.js";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
});

router.post("/", upload.single("file"), async (req: Request, res: Response, next: NextFunction) => {
  const start = performance.now();
  const requestId = req.headers["x-request-id"] as string;
  let fileName = "unknown";
  let documentId: string | undefined = undefined;

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

    // Resolve pre-registered document ID if provided by the client/frontend
    const documentIdFromReq = req.body.documentId || req.body.id || req.query.documentId || req.headers["x-document-id"];
    let existingDoc: any = null;

    if (documentIdFromReq) {
      const { data } = await supabase
        .from("knowledge_documents")
        .select("id, status")
        .eq("id", documentIdFromReq)
        .maybeSingle();
      existingDoc = data;
    }

    if (!existingDoc) {
      const { data } = await supabase
        .from("knowledge_documents")
        .select("id, status")
        .eq("file_name", fileName)
        .maybeSingle();
      existingDoc = data;
    }

    if (existingDoc) {
      documentId = existingDoc.id;
      // Set status to PROCESSANDO immediately in the database
      await supabase
        .from("knowledge_documents")
        .update({
          status: "PROCESSANDO",
          updated_at: new Date().toISOString()
        })
        .eq("id", documentId);
    } else {
      // Create a new document metadata row in PROCESSANDO status
      const { data, error: insertError } = await supabase
        .from("knowledge_documents")
        .insert({
          file_name: fileName,
          status: "PROCESSANDO",
          updated_at: new Date().toISOString()
        })
        .select()
        .single();

      if (insertError) throw insertError;
      documentId = data.id;
    }

    // Salva o PDF fisicamente em storage/documents/ para suporte a reprocessamento seguro
    try {
      const storageDir = path.join(process.cwd(), "storage", "documents");
      await fs.mkdir(storageDir, { recursive: true });
      const filePath = path.join(storageDir, fileName);
      await fs.writeFile(filePath, req.file.buffer);
      logger.info(`[ADMIN] PDF salvo fisicamente em: ${filePath}`);
    } catch (fsErr: any) {
      logger.warn(`[ADMIN] Erro ao salvar arquivo PDF físico: ${fsErr.message || fsErr}`);
    }

    // 1. Parsing robusto de PDF com limpeza e formatação de marcações
    const text = await readPdf(req.file.buffer);

    // 2. Fatiamento inteligente em chunks com conhecimento semântico e tracking de página
    const chunks = createChunks(text);

    console.log(`[UPLOAD] Gerando embeddings em lote para ${chunks.length} chunks para o documento: ${req.file.originalname}`);

    // 3. Geração de embeddings estrutural em lote com controle de taxa e retentativas
    const embeddings = await createEmbeddingsForChunks(chunks);

    // 4. Salvamento unificado com deduplicação de vetores e injeção de metadados (passing direct target documentId)
    const savedDocumentId = await saveKnowledge(
      req.file.originalname,
      chunks,
      embeddings,
      documentId
    );

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

    // Enforce updating document status to INDEXAÇÃO_INVÁLIDA if processing fails
    if (documentId) {
      try {
        await supabase
          .from("knowledge_documents")
          .update({
            status: "INDEXAÇÃO_INVÁLIDA",
            updated_at: new Date().toISOString()
          })
          .eq("id", documentId);
      } catch (dbErr: any) {
        logger.error(`[ADMIN] Erro ao atualizar status para INDEXAÇÃO_INVÁLIDA para o documento ${documentId}:`, dbErr);
      }
    }

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
