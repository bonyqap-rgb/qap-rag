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

/**
 * Garante que o bucket persistente de documentos exista antes do upload.
 * Isso evita o erro 500 quando o ambiente Supabase foi criado sem o bucket.
 */
async function ensureDocumentsBucket(): Promise<void> {
  const bucketName = "documents";

  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) {
    throw new Error(`Não foi possível verificar o bucket '${bucketName}': ${listError.message}`);
  }

  const exists = buckets?.some((bucket) => bucket.name === bucketName);
  if (exists) return;

  const { error: createError } = await supabase.storage.createBucket(bucketName, {
    public: false,
    fileSizeLimit: "50MB",
    allowedMimeTypes: ["application/pdf"],
  });

  if (createError && !/already exists|duplicate/i.test(createError.message || "")) {
    throw new Error(`Não foi possível criar o bucket '${bucketName}': ${createError.message}`);
  }

  logger.info(`[UPLOAD] Bucket Supabase '${bucketName}' verificado/criado com sucesso.`);
}

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

    fileName = path.basename(req.file.originalname);

    logger.info("[ADMIN] Upload de documento iniciado", {
      requestId,
      filename: fileName,
      fileSize: req.file.size,
    });

    // Salva o PDF fisicamente em storage/documents/ como fallback local.
    // O armazenamento persistente oficial é o Supabase Storage.
    try {
      const storageDir = path.join(process.cwd(), "storage", "documents");
      await fs.mkdir(storageDir, { recursive: true });
      const filePath = path.join(storageDir, fileName);
      await fs.writeFile(filePath, req.file.buffer);
      logger.info(`[ADMIN] PDF salvo fisicamente em: ${filePath}`);
    } catch (fsErr: any) {
      logger.warn(`[ADMIN] Erro ao salvar arquivo PDF físico: ${fsErr.message || fsErr}`);
    }

    // Resolve ou encontra documento pré-registrado primeiro.
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

    // 1. Garantir bucket e salvar o PDF no Supabase Storage.
    let savedPath = "";
    try {
      const bucketName = "documents";
      await ensureDocumentsBucket();

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

      if (documentId) {
        await supabase
          .from("knowledge_documents")
          .update({
            status: "INDEXAÇÃO_INVÁLIDA",
            updated_at: new Date().toISOString()
          })
          .eq("id", documentId);
      } else {
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

    // 2. Gravar caminho em knowledge_documents.storage_path e marcar como PROCESSANDO.
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

    // 3. Somente então iniciar o processamento/indexação.
    let text = "";
    let chunks: string[] = [];
    const embeddings: number[][] = [];

    try {
      text = await readPdf(req.file.buffer);
      chunks = createChunks(text);

      console.log(`[UPLOAD] Gerando ${chunks.length} embeddings para o documento: ${req.file.originalname}`);

      for (const chunk of chunks) {
        embeddings.push(await createEmbedding(chunk));
      }
    } catch (processError: any) {
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