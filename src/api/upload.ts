import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import fs from "fs/promises";
import path from "path";
import { readPdf } from "../pdf/readPdf.js";
import { createChunks } from "../chunker/createChunks.js";
import { createEmbedding } from "../groq/embed.js";
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
  let documentId = (req.body?.documentId || req.query?.documentId) as string | undefined;

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

    // Resolve or find the pre-registered document in database
    if (!documentId) {
      const { data: existingDoc } = await supabase
        .from("knowledge_documents")
        .select("id")
        .eq("file_name", fileName)
        .maybeSingle();
      if (existingDoc) {
        documentId = existingDoc.id;
      }
    }

    // Instantly transition the record status to PROCESSANDO on start and reset metrics
    if (documentId) {
      await supabase
        .from("knowledge_documents")
        .update({
          status: "PROCESSANDO",
          total_chunks: 0,
          total_embeddings: 0,
          extracted_chars: 0,
          updated_at: new Date().toISOString()
        })
        .eq("id", documentId);
      logger.info(`[UPLOAD] Documento ${fileName} (ID: ${documentId}) marcado como PROCESSANDO no início.`);
    }

    let text = "";
    let chunks: string[] = [];
    const embeddings: number[][] = [];

    try {
      // 1. Parsing robusto de PDF com limpeza e formatação de marcações
      text = await readPdf(req.file.buffer);

      // 2. Fatiamento inteligente em chunks com conhecimento semântico e tracking de página
      chunks = createChunks(text);

      console.log(`[UPLOAD] Gerando ${chunks.length} embeddings para o documento: ${req.file.originalname}`);

      // 3. Geração de embeddings com suporte a validação, retentativas e cache interno de duplicatas
      for (const chunk of chunks) {
        embeddings.push(await createEmbedding(chunk));
      }
    } catch (processError: any) {
      // If error occurs during parsing, chunking or embedding generation, transition status to INDEXAÇÃO_INVÁLIDA
      if (documentId) {
        await supabase
          .from("knowledge_documents")
          .update({
            status: "INDEXAÇÃO_INVÁLIDA",
            updated_at: new Date().toISOString()
          })
          .eq("id", documentId);
        logger.warn(`[UPLOAD] Documento ${fileName} (ID: ${documentId}) marcado como INDEXAÇÃO_INVÁLIDA devido a falha no processamento.`, {
          error: processError.message || String(processError)
        });
      }
      throw processError;
    }

    // 4. Salvamento unificado com deduplicação de vetores e injeção de metadados
    const savedDocId = await saveKnowledge(
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
      documentId: savedDocId,
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
