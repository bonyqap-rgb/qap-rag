import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import fs from "fs/promises";
import path from "path";
import { readPdf } from "../pdf/readPdf.js";
import { createChunks } from "../chunker/createChunks.js";
import { createEmbedding, createEmbeddingsForChunks } from "../groq/embed.js";
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

    // Resolve or find pre-registered document ID first
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

    // 1. Salvar o arquivo PDF no Supabase Storage, bucket documents
    let savedPath = "";
    try {
      const bucketName = "documents";
      const { data: storageData, error: storageErr } = await supabase.storage
        .from(bucketName)
        .upload(fileName, req.file.buffer, {
          contentType: "application/pdf",
          upsert: true,
        });

      if (storageErr) {
        throw storageErr;
      }

      savedPath = storageData?.path ? `documents/${storageData.path}` : `documents/${fileName}`;
      logger.info(`[UPLOAD] PDF salvo com sucesso no Supabase Storage: ${savedPath}`);
    } catch (storageErr: any) {
      logger.error(`[UPLOAD] Erro ao salvar arquivo no Supabase Storage: ${storageErr.message || storageErr}`);

      // Transition existing or pre-registered document status to INDEXAÇÃO_INVÁLIDA
      if (documentId) {
        await supabase
          .from("knowledge_documents")
          .update({
            status: "INDEXAÇÃO_INVÁLIDA",
            updated_at: new Date().toISOString()
          })
          .eq("id", documentId);
      } else {
        // Create document record with status INDEXAÇÃO_INVÁLIDA
        await supabase
          .from("knowledge_documents")
          .insert({
            file_name: fileName,
            status: "INDEXAÇÃO_INVÁLIDA",
            updated_at: new Date().toISOString()
          });
      }
      throw new Error(`Falha ao salvar no Supabase Storage: ${storageErr.message || storageErr}`);
    }

    // 2. Gravar esse caminho em knowledge_documents.storage_path e marcar como PROCESSANDO
    if (documentId) {
      await supabase
        .from("knowledge_documents")
        .update({
          storage_path: savedPath,
          status: "PROCESSANDO",
          total_chunks: 0,
          total_embeddings: 0,
          extracted_chars: 0,
          file_size: req.file.size,
          mime_type: req.file.mimetype,
          updated_at: new Date().toISOString()
        })
        .eq("id", documentId);
      logger.info(`[UPLOAD] Documento ${fileName} (ID: ${documentId}) atualizado com storage_path e marcado como PROCESSANDO.`);
    } else {
      const { data: newDoc, error: insertErr } = await supabase
        .from("knowledge_documents")
        .insert({
          file_name: fileName,
          storage_path: savedPath,
          status: "PROCESSANDO",
          total_chunks: 0,
          total_embeddings: 0,
          extracted_chars: 0,
          file_size: req.file.size,
          mime_type: req.file.mimetype,
          updated_at: new Date().toISOString()
        })
        .select()
        .single();

      if (insertErr) {
        throw insertErr;
      }
      if (newDoc) {
        documentId = newDoc.id;
        logger.info(`[UPLOAD] Novo documento registrado (ID: ${documentId}) com storage_path e marcado como PROCESSANDO.`);
      }
    }

    // 3. Somente então iniciar o processamento/indexação
    let text = "";
    let chunks: string[] = [];
    const embeddings: number[][] = [];

    try {
      // Parsing robusto de PDF com limpeza e formatação de marcações
      text = await readPdf(req.file.buffer);

      // Fatiamento inteligente em chunks com conhecimento semântico e tracking de página
      chunks = createChunks(text);

      console.log(`[UPLOAD] Gerando ${chunks.length} embeddings para o documento: ${req.file.originalname}`);

      // Geração de embeddings em lotes seguros com throttling para evitar HTTP 429 Rate Limits
      const generatedEmbeddings = await createEmbeddingsForChunks(chunks);
      embeddings.push(...generatedEmbeddings);
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

    // Salvamento unificado com deduplicação de vetores e injeção de metadados
    const savedDocId = await saveKnowledge(
      req.file.originalname,
      chunks,
      embeddings,
      documentId,
      savedPath
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