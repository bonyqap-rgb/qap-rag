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

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
});

router.post("/", upload.single("file"), async (req: Request, res: Response, next: NextFunction) => {
  const start = performance.now();
  const requestId = req.headers["x-request-id"] as string;
  let fileName = "unknown";
  let documentId: string | null = null;
  let storagePath: string | null = null;

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

    // Ensure bucket "documents" exists
    const { supabase } = await import("../config/supabase.js");
    const bucketName = "documents";
    try {
      await supabase.storage.createBucket(bucketName, { public: true });
    } catch (bucketErr) {
      // Ignore if bucket already exists
    }

    // A. PRÉ-REGISTRO / PERSISTÊNCIA INICIAL DO DOCUMENTO
    // Mantém o ID do documento durante todo o fluxo do upload para evitar arquivos órfãos em caso de falha.
    const timestamp = new Date().toISOString();
    const { data: existingDoc } = await supabase
      .from("knowledge_documents")
      .select("id, storage_path")
      .eq("file_name", fileName)
      .maybeSingle();

    if (existingDoc) {
      documentId = existingDoc.id;
      // Atualiza o status do documento para PROCESSANDO no início
      await supabase
        .from("knowledge_documents")
        .update({
          status: "PROCESSANDO",
          updated_at: timestamp
        })
        .eq("id", documentId);
    } else {
      // Cria o registro em PROCESSANDO no início
      const { data: newDoc, error: insertError } = await supabase
        .from("knowledge_documents")
        .insert({
          file_name: fileName,
          status: "PROCESSANDO",
          updated_at: timestamp
        })
        .select("id")
        .single();

      if (insertError) {
        throw insertError;
      }
      documentId = newDoc.id;
    }

    logger.info(`[UPLOAD] Fazendo upload do PDF para o Supabase Storage no bucket '${bucketName}'...`);
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(bucketName)
      .upload(fileName, req.file.buffer, {
        contentType: req.file.mimetype || "application/pdf",
        upsert: true,
      });

    if (uploadError) {
      throw new Error(`Falha no upload do arquivo para o Supabase Storage: ${uploadError.message}`);
    }

    storagePath = uploadData?.path || fileName;
    logger.info(`[UPLOAD] PDF enviado com sucesso para o Storage. Caminho: ${storagePath}`);

    // Salva também o PDF fisicamente em storage/documents/ para suporte a reprocessamento local como redundância de segurança
    try {
      const storageDir = path.join(process.cwd(), "storage", "documents");
      await fs.mkdir(storageDir, { recursive: true });
      const filePath = path.join(storageDir, fileName);
      await fs.writeFile(filePath, req.file.buffer);
      logger.info(`[ADMIN] PDF salvo fisicamente em local-fallback: ${filePath}`);
    } catch (fsErr: any) {
      logger.warn(`[ADMIN] Erro ao salvar arquivo PDF físico em local-fallback: ${fsErr.message || fsErr}`);
    }

    // 1. Parsing robusto de PDF com limpeza e formatação de marcações
    const text = await readPdf(req.file.buffer);

    // 2. Fatiamento inteligente em chunks com conhecimento semântico e tracking de página
    const chunks = createChunks(text);

    console.log(`[UPLOAD] Gerando ${chunks.length} embeddings de forma concorrente controlada para evitar 429...`);

    // 3. Geração de embeddings com batching, retentativas e controle estrito de concorrência
    const { generateEmbeddingsWithConcurrency } = await import("../groq/embed.js");
    const embeddings = await generateEmbeddingsWithConcurrency(chunks, 3, 200);

    // 4. Salvamento unificado com deduplicação de vetores, injeção de metadados e o storagePath
    const documentIdSaved = await saveKnowledge(
      req.file.originalname,
      chunks,
      embeddings,
      storagePath
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
      documentId: documentIdSaved,
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

    // Diagnóstico de erros e persistência de status seguro:
    // Garante que o status do registro seja atualizado para INDEXAÇÃO_INVÁLIDA em caso de falha em qualquer etapa posterior ao pré-registro,
    // sem perder a referência do storage_path nem o erro original.
    const { supabase } = await import("../config/supabase.js");
    if (documentId) {
      try {
        await supabase
          .from("knowledge_documents")
          .update({
            status: "INDEXAÇÃO_INVÁLIDA",
            storage_path: storagePath || null,
            updated_at: new Date().toISOString()
          })
          .eq("id", documentId);
        logger.info(`[UPLOAD] Status do documento ID ${documentId} atualizado para INDEXAÇÃO_INVÁLIDA devido a falha: ${error.message || error}`);
      } catch (dbErr: any) {
        logger.error(`[UPLOAD] Falha ao atualizar status para INDEXAÇÃO_INVÁLIDA do documento ID ${documentId}: ${dbErr.message}`);
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

    // Determine accurate status code based on actual error content
    let statusCode = 500;
    if (error.status) {
      statusCode = error.status;
    } else if (error.message?.includes("429") || error.message?.toLowerCase().includes("rate limit") || error.message?.toLowerCase().includes("limite excedido")) {
      statusCode = 429;
    } else if (error.statusCode) {
      statusCode = error.statusCode;
    }

    return res.status(statusCode).json({
      success: false,
      error: error.message || "Erro interno no servidor ao processar upload.",
      cause: error.originalError?.message || error.message || String(error)
    });
  }
});

export default router;
