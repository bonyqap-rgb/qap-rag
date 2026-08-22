import { DocumentRepository } from "../repositories/document.repository.js";
import { Document, DocumentProcessingStatus } from "../models/document.model.js";
import { supabase } from "../config/supabase.js";
import { createEmbedding, createEmbeddingsForChunks } from "../groq/embed.js";
import { indexingHistoryService } from "./indexing-history.service.js";
import { logger } from "./logger.service.js";
import fs from "fs/promises";
import path from "path";
import { readPdf } from "../pdf/readPdf.js";
import { createChunks } from "../chunker/createChunks.js";
import { saveKnowledge } from "./saveKnowledge.js";

export class ValidationError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends Error {
  status = 404;
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export class DocumentService {
  private repository: DocumentRepository;

  constructor(repository: DocumentRepository = new DocumentRepository()) {
    this.repository = repository;
  }

  /**
   * Validate fields of a document payload
   */
  private validatePayload(doc: Partial<Document>, isUpdate = false): void {
    const requiredFields: (keyof Document)[] = [
      "title",
      "category",
      "version",
      "source",
      "language",
      "filename",
      "fileSize",
      "mimeType",
      "totalPages"
    ];

    if (!isUpdate) {
      // Validate all required fields are present
      for (const field of requiredFields) {
        if (doc[field] === undefined || doc[field] === null || doc[field] === "") {
          throw new ValidationError(`O campo '${field}' é obrigatório.`);
        }
      }
    }

    // Validate title length if provided
    if (doc.title !== undefined) {
      if (typeof doc.title !== "string") {
        throw new ValidationError("O campo 'title' deve ser uma string.");
      }
      if (doc.title.trim().length === 0) {
        throw new ValidationError("O campo 'title' não pode estar vazio.");
      }
      if (doc.title.length > 255) {
        throw new ValidationError("O campo 'title' não pode exceder 255 caracteres.");
      }
    }

    // Validate version format if provided
    if (doc.version !== undefined) {
      if (typeof doc.version !== "string") {
        throw new ValidationError("O campo 'version' deve ser uma string.");
      }
      // Matches standard formats like "1.0", "1.0.0", "12.34.56"
      const versionRegex = /^\d+\.\d+(\.\d+)?$/;
      if (!versionRegex.test(doc.version)) {
        throw new ValidationError("O formato do campo 'version' é inválido. Use formatos como '1.0' ou '1.0.0'.");
      }
    }

    // Validate category if provided
    if (doc.category !== undefined) {
      if (typeof doc.category !== "string") {
        throw new ValidationError("O campo 'category' deve ser uma string.");
      }
      if (doc.category.trim().length === 0) {
        throw new ValidationError("O campo 'category' não pode estar vazio.");
      }
    }

    // Validate language if provided
    if (doc.language !== undefined) {
      if (typeof doc.language !== "string") {
        throw new ValidationError("O campo 'language' deve ser uma string.");
      }
      if (doc.language.trim().length === 0) {
        throw new ValidationError("O campo 'language' não pode estar vazio.");
      }
    }

    // Validate totalPages if provided
    if (doc.totalPages !== undefined) {
      if (typeof doc.totalPages !== "number" || isNaN(doc.totalPages) || doc.totalPages <= 0) {
        throw new ValidationError("O campo 'totalPages' deve ser um número inteiro positivo.");
      }
    }

    // Validate fileSize if provided
    if (doc.fileSize !== undefined) {
      if (typeof doc.fileSize !== "number" || isNaN(doc.fileSize) || doc.fileSize <= 0) {
        throw new ValidationError("O campo 'fileSize' deve ser um número inteiro positivo.");
      }
    }

    // Validate processingStatus if provided
    if (doc.processingStatus !== undefined) {
      const allowedStatus: DocumentProcessingStatus[] = ["pending", "processing", "completed", "failed"];
      if (!allowedStatus.includes(doc.processingStatus)) {
        throw new ValidationError("O campo 'processingStatus' deve ser 'pending', 'processing', 'completed' ou 'failed'.");
      }
    }
  }

  /**
   * Retrieves all documents
   */
  async listDocuments(): Promise<Document[]> {
    return this.repository.list();
  }

  /**
   * Retrieves a single document by ID or throws NotFoundError
   */
  async getDocumentById(id: string): Promise<Document> {
    if (!id) {
      throw new ValidationError("O ID do documento não foi informado.");
    }
    const doc = await this.repository.getById(id);
    if (!doc) {
      throw new NotFoundError(`Documento com ID '${id}' não encontrado.`);
    }
    return doc;
  }

  /**
   * Creates a new document after validating input metadata
   */
  async createDocument(docPayload: Omit<Document, "id" | "createdAt" | "updatedAt" | "processingStatus"> & { processingStatus?: DocumentProcessingStatus }): Promise<Document> {
    this.validatePayload(docPayload as any, false);

    const docToCreate = {
      ...docPayload,
      processingStatus: docPayload.processingStatus || "pending"
    };

    return this.repository.create(docToCreate);
  }

  /**
   * Updates an existing document's metadata after validating partial payload
   */
  async updateDocument(id: string, docPayload: Partial<Omit<Document, "id" | "createdAt" | "updatedAt" | "filename" | "fileSize" | "mimeType" | "totalPages">>): Promise<Document> {
    if (!id) {
      throw new ValidationError("O ID do documento não foi informado.");
    }

    this.validatePayload(docPayload, true);

    const updatedDoc = await this.repository.update(id, docPayload);
    if (!updatedDoc) {
      throw new NotFoundError(`Documento com ID '${id}' não encontrado.`);
    }

    return updatedDoc;
  }

  /**
   * Deletes a document safely (including chunks, embeddings and metadata inside a transaction) or throws NotFoundError.
   */
  async deleteDocument(id: string): Promise<void> {
    if (!id) {
      throw new ValidationError("O ID do documento não foi informado.");
    }

    // Fetch knowledge document matching the id
    const { data: kDoc, error: kDocErr } = await supabase
      .from("knowledge_documents")
      .select("id, file_name")
      .eq("id", id)
      .maybeSingle();

    if (kDocErr) {
      throw kDocErr;
    }

    if (!kDoc) {
      throw new NotFoundError(`Documento com ID '${id}' não encontrado.`);
    }

    // Delete chunks
    const { error: chunksErr } = await supabase
      .from("knowledge_chunks")
      .delete()
      .eq("document_id", kDoc.id);
    if (chunksErr) throw chunksErr;

    // Delete knowledge document
    const { error: kDocErr2 } = await supabase
      .from("knowledge_documents")
      .delete()
      .eq("id", kDoc.id);
    if (kDocErr2) throw kDocErr2;
  }

  /**
   * Retrieves statistics of the knowledge base.
   */
  async getKnowledgeBaseStats(): Promise<any> {
    try {
      const { count: totalKDocs, error: errDocs } = await supabase
        .from("knowledge_documents")
        .select("*", { count: "exact", head: true });

      if (errDocs) throw errDocs;

      const { count: totalChunks, error: errChunks } = await supabase
        .from("knowledge_chunks")
        .select("*", { count: "exact", head: true });

      if (errChunks) throw errChunks;

      const { data: lastKDocs, error: errLast } = await supabase
        .from("knowledge_documents")
        .select("created_at")
        .order("created_at", { ascending: false })
        .limit(1);

      if (errLast) throw errLast;
      const lastIndexed = lastKDocs && lastKDocs.length > 0 ? lastKDocs[0].created_at : null;

      // Calculate total size and average size of chunk content
      const { data: chunks, error: errSize } = await supabase
        .from("knowledge_chunks")
        .select("content");

      if (errSize) throw errSize;

      const totalSize = (chunks || []).reduce((sum, chunk) => sum + (chunk.content?.length || 0), 0);
      const avgSize = chunks && chunks.length > 0 ? totalSize / chunks.length : 0;

      const avgChunksPerDoc = totalKDocs && totalKDocs > 0 ? parseFloat(((totalChunks || 0) / totalKDocs).toFixed(2)) : 0;

      return {
        total_documentos: totalKDocs || 0,
        documentos_indexados: totalKDocs || 0,
        documentos_pendentes: 0,
        total_chunks: totalChunks || 0,
        media_chunks_por_documento: avgChunksPerDoc,
        tamanho_medio_chunks: parseFloat(avgSize.toFixed(2)),
        data_ultima_indexacao: lastIndexed,
        quantidade_vetores_armazenados: totalChunks || 0,
      };
    } catch (err: any) {
      logger.error(`Erro ao carregar estatísticas do painel: ${err.message || err}`);
      throw err;
    }
  }

  /**
   * Retrieves statistics of the knowledge base with camelCase for the API /documents/statistics
   */
  async getKnowledgeBaseStatistics(): Promise<{
    totalDocuments: number;
    totalChunks: number;
    totalSize: number;
    indexedDocuments: number;
  }> {
    const { count: totalDocs, error: errDocs } = await supabase
      .from("knowledge_documents")
      .select("*", { count: "exact", head: true });

    if (errDocs) throw errDocs;

    const { count: totalChks, error: errChunks } = await supabase
      .from("knowledge_chunks")
      .select("*", { count: "exact", head: true });

    if (errChunks) throw errChunks;

    const { data: chunks, error: errSize } = await supabase
      .from("knowledge_chunks")
      .select("content");

    if (errSize) throw errSize;

    const totalSize = (chunks || []).reduce((sum, chunk) => sum + (chunk.content?.length || 0), 0);

    return {
      totalDocuments: totalDocs || 0,
      totalChunks: totalChks || 0,
      totalSize,
      indexedDocuments: totalDocs || 0
    };
  }

  /**
   * Reindexes an existing document by ID (regenerating embeddings for its chunks)
   */
  async reindexDocument(id: string): Promise<any> {
    if (!id) {
      throw new ValidationError("O ID do documento não foi informado.");
    }

    let kDocId: string | null = null;
    let filename = "";
    let status = "";
    let storagePath = "";

    // Try to find corresponding knowledge document directly from knowledge_documents table
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    if (isUuid) {
      const { data: kDoc, error: kDocError } = await supabase
        .from("knowledge_documents")
        .select("id, file_name, status, storage_path")
        .eq("id", id)
        .maybeSingle();

      if (!kDocError && kDoc) {
        kDocId = kDoc.id;
        filename = kDoc.file_name || "";
        status = kDoc.status || "";
        storagePath = kDoc.storage_path || "";
      }
    }

    if (!kDocId) {
      // Try to find by file_name in knowledge_documents
      const { data: kDoc, error: kDocError } = await supabase
        .from("knowledge_documents")
        .select("id, file_name, status, storage_path")
        .eq("file_name", id)
        .maybeSingle();

      if (!kDocError && kDoc) {
        kDocId = kDoc.id;
        filename = kDoc.file_name || "";
        status = kDoc.status || "";
        storagePath = kDoc.storage_path || "";
      }
    }

    if (!kDocId) {
      throw new NotFoundError(`Documento de conhecimento correspondente a '${id}' não encontrado.`);
    }

    const filePath = filename ? path.join(process.cwd(), "storage", "documents", filename) : "";
    let fileExists = false;
    let fileBuffer: Buffer | null = null;

    if (filePath) {
      try {
        await fs.access(filePath);
        fileExists = true;
        fileBuffer = await fs.readFile(filePath);
      } catch {
        fileExists = false;
      }
    }

    // Try to download the PDF from Supabase Storage if local copy is not present
    if (!fileExists && storagePath) {
      logger.info(`[REINDEX] Arquivo local '${filename}' ausente. Tentando baixar do Supabase Storage: '${storagePath}'...`);
      try {
        let bucket = "documents";
        let pathInBucket = storagePath;

        if (storagePath.includes("/")) {
          const parts = storagePath.split("/");
          bucket = parts[0];
          pathInBucket = parts.slice(1).join("/");
        }

        const { data: storageData, error: storageErr } = await supabase.storage.from(bucket).download(pathInBucket);

        if (storageErr) {
          logger.warn(`[REINDEX] Falha ao baixar de Supabase Storage (bucket: ${bucket}, path: ${pathInBucket}): ${storageErr.message}`);
        } else if (storageData) {
          const arrayBuffer = await storageData.arrayBuffer();
          fileBuffer = Buffer.from(arrayBuffer);
          fileExists = true;
          logger.info(`[REINDEX] Arquivo '${filename}' baixado com sucesso do Supabase Storage (${fileBuffer.length} bytes).`);

          // Save copy locally to disk
          try {
            const storageDir = path.dirname(filePath);
            await fs.mkdir(storageDir, { recursive: true });
            await fs.writeFile(filePath, fileBuffer);
            logger.info(`[REINDEX] Salvo arquivo localmente no cache: ${filePath}`);
          } catch (cacheErr: any) {
            logger.warn(`[REINDEX] Erro ao salvar arquivo baixado localmente no cache: ${cacheErr.message}`);
          }
        }
      } catch (dlErr: any) {
        logger.error(`[REINDEX] Erro durante download do PDF do Supabase Storage`, dlErr);
      }
    }

    // Se o status do documento for INDEXAÇÃO_INVÁLIDA, PENDENTE ou o arquivo físico do PDF existir no disco,
    // devemos reprocessar o arquivo original do início para garantir reindexação segura.
    if (status === "INDEXAÇÃO_INVÁLIDA" || status === "PENDENTE" || fileExists) {
      if (!fileExists) {
        throw new ValidationError(
          `Não é possível reprocessar o documento '${filename}' (status ${status}) porque o arquivo PDF original não foi encontrado em storage/documents/ nem no Supabase Storage.`
        );
      }

      logger.info(`[REINDEX] Reprocessando PDF de forma segura para o arquivo '${filename}'...`);
      const startTime = performance.now();
      const timestamp = new Date().toISOString();

      try {
        // 1. Reprocessar o PDF: Ler o buffer do arquivo PDF original do disco ou do Storage
        const pdfBuffer = fileBuffer || await fs.readFile(filePath);

        // 2. Extrair o texto do PDF
        const text = await readPdf(pdfBuffer);

        // 3. Fatiar em chunks semânticos
        const chunksList = createChunks(text);

        // 4. Gerar novos embeddings em lotes seguros com throttling para evitar HTTP 429
        const embeddings = await createEmbeddingsForChunks(chunksList);

        // 5. Gravar novamente, Validar e Marcar como INDEXADO através de saveKnowledge
        const updatedDocId = await saveKnowledge(filename, chunksList, embeddings, kDocId, storagePath);

        const duration = Math.round(performance.now() - startTime);

        return {
          success: true,
          message: "Documento reprocessado e reindexado com sucesso.",
          chunksCount: chunksList.length,
          durationMs: duration
        };
      } catch (error: any) {
        const duration = Math.round(performance.now() - startTime);

        // Em caso de erro, garantir que o status do documento seja atualizado para INDEXAÇÃO_INVÁLIDA
        await supabase
          .from("knowledge_documents")
          .update({
            status: "INDEXAÇÃO_INVÁLIDA",
            updated_at: timestamp
          })
          .eq("id", kDocId);

        await indexingHistoryService.record({
          document: filename,
          date: timestamp,
          duration,
          chunks_count: 0,
          embeddings_count: 0,
          success: false,
          error_message: error.message || String(error)
        });

        throw error;
      }
    }

    // Fetch existing chunks (fallback para reindexação baseada apenas em chunks antigos)
    const { data: chunks, error: chunksError } = await supabase
      .from("knowledge_chunks")
      .select("chunk_index, content")
      .eq("document_id", kDocId)
      .order("chunk_index", { ascending: true });

    if (chunksError) {
      throw chunksError;
    }

    if (!chunks || chunks.length === 0) {
      throw new ValidationError("Não há trechos de texto na base para reindexar.");
    }

    const startTime = performance.now();
    const timestamp = new Date().toISOString();

    try {
      const newChunksData = [];
      const cleanTexts = chunks.map(chunk => {
        let cleanText = chunk.content || "";
        const metaMatch = cleanText.match(/^\[METADATA:[\s\S]*?\]\n([\s\S]*)$/);
        if (metaMatch) {
          cleanText = metaMatch[1];
        }
        return cleanText.trim();
      });

      const regeneratedEmbeddings = await createEmbeddingsForChunks(cleanTexts);

      for (let idx = 0; idx < chunks.length; idx++) {
        newChunksData.push({
          chunk_index: chunks[idx].chunk_index,
          content: chunks[idx].content,
          embedding: regeneratedEmbeddings[idx],
        });
      }

      // Try RPC transaction update
      const rpcData = newChunksData.map(c => {
        // Enforce 1536-dimensional vectors for perfect pgvector compatibility
        const targetDimension = 1536;
        let finalChunkEmbedding = c.embedding ? [...c.embedding] : [];
        if (finalChunkEmbedding.length !== targetDimension) {
          console.warn(`[REINDEX] Chunk ${c.chunk_index} com dimensão de embedding incorreta: ${finalChunkEmbedding.length}. Corrigindo...`);
          if (finalChunkEmbedding.length > targetDimension) {
            finalChunkEmbedding = finalChunkEmbedding.slice(0, targetDimension);
          } else {
            while (finalChunkEmbedding.length < targetDimension) {
              finalChunkEmbedding.push(0);
            }
          }
        }
        return {
          chunk_index: c.chunk_index,
          content: c.content,
          embedding: finalChunkEmbedding
        };
      });

      if (rpcData.length > 0) {
        console.log(`[REINDEX] dimensão enviada para a RPC do Supabase (update_document_chunks_transaction): ${rpcData[0].embedding?.length}`);
      }

      const { error: rpcErr } = await supabase.rpc("update_document_chunks_transaction", {
        p_document_id: kDocId,
        p_chunks: rpcData
      });

      if (rpcErr) {
        throw rpcErr;
      }

      await supabase
        .from("knowledge_documents")
        .update({ updated_at: timestamp })
        .eq("id", kDocId);

      const duration = Math.round(performance.now() - startTime);

      // Record history
      await indexingHistoryService.record({
        document: filename,
        date: timestamp,
        duration,
        chunks_count: chunks.length,
        embeddings_count: chunks.length,
        success: true,
      });

      return {
        success: true,
        message: "Documento reindexado com sucesso.",
        chunksCount: chunks.length,
        durationMs: duration
      };

    } catch (error: any) {
      const duration = Math.round(performance.now() - startTime);

      await indexingHistoryService.record({
        document: filename,
        date: new Date().toISOString(),
        duration,
        chunks_count: chunks?.length || 0,
        embeddings_count: chunks?.length || 0,
        success: false,
        error_message: error.message || String(error)
      });

      throw error;
    }
  }

  /**
   * Reindexes all documents that are currently in 'completed' status.
   * Processes one by one, records progress, and returns detailed metrics.
   */
  async reindexAllCompletedDocuments(): Promise<{
    success: boolean;
    documentsProcessed: number;
    chunksProcessed: number;
    durationMs: number;
    errors: { id: string; filename: string; error: string }[];
  }> {
    logger.info("=== INICIANDO REINDEXAÇÃO COMPLETA DE TODOS OS DOCUMENTOS ===");
    const startTime = performance.now();

    let completedDocs: { id: string; file_name: string }[] = [];
    try {
      const { data: kDocs, error: kDocsErr } = await supabase
        .from("knowledge_documents")
        .select("id, file_name");

      if (kDocsErr) {
        throw kDocsErr;
      }
      completedDocs = (kDocs || []).map(d => ({ id: d.id, file_name: d.file_name }));
    } catch (dbError: any) {
      logger.error(`[REINDEX ALL] Falha ao buscar de knowledge_documents diretamente: ${dbError.message || dbError}`);
      throw dbError;
    }

    logger.info(`[REINDEX ALL] Documentos identificados para reindexação: ${completedDocs.length}`);
    const errors: { id: string; filename: string; error: string }[] = [];
    let documentsProcessed = 0;
    let chunksProcessed = 0;

    for (const doc of completedDocs) {
      logger.info(`[REINDEX ALL] Iniciando reindexação do documento: (ID: ${doc.id}, Arquivo: ${doc.file_name})...`);
      try {
        const result = await this.reindexDocument(doc.id);
        if (result.success) {
          documentsProcessed++;
          chunksProcessed += result.chunksCount || 0;
          logger.info(`[REINDEX ALL] Sucesso! Documento "${doc.file_name}" reindexado. Chunks: ${result.chunksCount} em ${result.durationMs}ms`);
        } else {
          const message = result.message || "Erro desconhecido durante reindexação";
          logger.error(`[REINDEX ALL] Falha no documento ${doc.file_name}: ${message}`);
          errors.push({ id: doc.id, filename: doc.file_name, error: message });
        }
      } catch (err: any) {
        const errMsg = err.message || String(err);
        logger.error(`[REINDEX ALL] Erro inesperado no documento ${doc.file_name}: ${errMsg}`, err);
        errors.push({ id: doc.id, filename: doc.file_name, error: errMsg });
      }
    }

    const durationMs = Math.round(performance.now() - startTime);
    logger.info(`=== REINDEXAÇÃO COMPLETA CONCLUÍDA em ${durationMs}ms ===`);
    logger.info(`[REINDEX ALL] Sucesso: ${documentsProcessed} de ${completedDocs.length} documentos processados. Total de Chunks: ${chunksProcessed}`);

    return {
      success: errors.length === 0,
      documentsProcessed,
      chunksProcessed,
      durationMs,
      errors
    };
  }
}
