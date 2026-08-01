import { DocumentRepository } from "../repositories/document.repository.js";
import { Document, DocumentProcessingStatus } from "../models/document.model.js";
import { supabase } from "../config/supabase.js";
import { createEmbedding } from "../groq/embed.js";
import { indexingHistoryService } from "./indexing-history.service.js";
import { logger } from "./logger.service.js";

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

    const doc = await this.repository.getById(id);
    if (!doc) {
      throw new NotFoundError(`Documento com ID '${id}' não encontrado.`);
    }

    // Try executing SQL transaction via RPC
    const { data: rpcSuccess, error: rpcError } = await supabase.rpc("delete_document_transaction", { doc_id: id });

    if (rpcError) {
      logger.warn(`RPC delete_document_transaction falhou: ${rpcError.message}. Executando exclusão sequencial fallback...`);

      // Fallback: Sequential deletion
      // Find knowledge document matching the filename
      const { data: kDoc } = await supabase
        .from("knowledge_documents")
        .select("id")
        .eq("file_name", doc.filename)
        .maybeSingle();

      if (kDoc) {
        // Delete chunks
        const { error: chunksErr } = await supabase
          .from("knowledge_chunks")
          .delete()
          .eq("document_id", kDoc.id);
        if (chunksErr) throw chunksErr;

        // Delete knowledge document
        const { error: kDocErr } = await supabase
          .from("knowledge_documents")
          .delete()
          .eq("id", kDoc.id);
        if (kDocErr) throw kDocErr;
      }

      // Delete document metadata from documents table
      const deleted = await this.repository.delete(id);
      if (!deleted) {
        throw new NotFoundError(`Documento com ID '${id}' não pôde ser excluído.`);
      }
    } else if (!rpcSuccess) {
      // If RPC returned false, it means document wasn't found or already deleted
      throw new NotFoundError(`Documento com ID '${id}' não encontrado.`);
    }
  }

  /**
   * Retrieves statistics of the knowledge base.
   */
  async getKnowledgeBaseStats(): Promise<any> {
    const { data, error } = await supabase.rpc("get_knowledge_base_stats");
    if (error) {
      logger.warn(`RPC get_knowledge_base_stats falhou ou não existe: ${error.message}. Calculando via consultas de fallback...`);
      return this.getStatsFallback();
    }
    return data;
  }

  /**
   * Backup/Fallback stats calculator if PostgreSQL RPC is unavailable.
   */
  private async getStatsFallback(): Promise<any> {
    const { count: totalDocs } = await supabase.from("documents").select("*", { count: "exact", head: true });
    const { count: indexedDocs } = await supabase.from("documents").select("*", { count: "exact", head: true }).eq("processing_status", "completed");
    const { count: pendingDocs } = await supabase.from("documents").select("*", { count: "exact", head: true }).eq("processing_status", "pending");
    const { count: totalChunks } = await supabase.from("knowledge_chunks").select("*", { count: "exact", head: true });
    const { count: totalKDocs } = await supabase.from("knowledge_documents").select("*", { count: "exact", head: true });

    const { data: lastKDocs } = await supabase.from("knowledge_documents").select("created_at").order("created_at", { ascending: false }).limit(1);
    const lastIndexed = lastKDocs && lastKDocs.length > 0 ? lastKDocs[0].created_at : null;

    const { data: chunksSample } = await supabase.from("knowledge_chunks").select("content").limit(100);
    let avgSize = 0;
    if (chunksSample && chunksSample.length > 0) {
      const totalLen = chunksSample.reduce((acc, c) => acc + (c.content?.length || 0), 0);
      avgSize = totalLen / chunksSample.length;
    }

    const avgChunksPerDoc = totalKDocs && totalKDocs > 0 ? parseFloat(((totalChunks || 0) / totalKDocs).toFixed(2)) : 0;

    return {
      total_documentos: totalDocs || 0,
      documentos_indexados: indexedDocs || 0,
      documentos_pendentes: pendingDocs || 0,
      total_chunks: totalChunks || 0,
      media_chunks_por_documento: avgChunksPerDoc,
      tamanho_medio_chunks: parseFloat(avgSize.toFixed(2)),
      data_ultima_indexacao: lastIndexed,
      quantidade_vetores_armazenados: totalChunks || 0,
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

    // Try to find corresponding knowledge document directly from knowledge_documents table
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    if (isUuid) {
      const { data: kDoc, error: kDocError } = await supabase
        .from("knowledge_documents")
        .select("id, file_name")
        .eq("id", id)
        .maybeSingle();

      if (!kDocError && kDoc) {
        kDocId = kDoc.id;
        filename = kDoc.file_name;
      }
    }

    if (!kDocId) {
      // Try to find by file_name in knowledge_documents
      const { data: kDoc, error: kDocError } = await supabase
        .from("knowledge_documents")
        .select("id, file_name")
        .eq("file_name", id)
        .maybeSingle();

      if (!kDocError && kDoc) {
        kDocId = kDoc.id;
        filename = kDoc.file_name;
      }
    }

    if (!kDocId) {
      throw new NotFoundError(`Documento de conhecimento correspondente a '${id}' não encontrado.`);
    }

    // Fetch existing chunks
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

      for (const chunk of chunks) {
        let cleanText = chunk.content || "";
        const metaMatch = cleanText.match(/^\[METADATA:[\s\S]*?\]\n([\s\S]*)$/);
        if (metaMatch) {
          cleanText = metaMatch[1];
        }
        cleanText = cleanText.trim();

        // Regenerate embedding vector
        const embedding = await createEmbedding(cleanText);

        newChunksData.push({
          chunk_index: chunk.chunk_index,
          content: chunk.content,
          embedding,
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
        p_k_doc_id: kDocId,
        p_chunks_data: rpcData
      });

      if (rpcErr) {
        logger.warn(`RPC update_document_chunks_transaction falhou: ${rpcErr.message}. Executando reindexação sequencial fallback...`);

        // Fallback: Delete old and insert new sequentially
        const { error: delErr } = await supabase
          .from("knowledge_chunks")
          .delete()
          .eq("document_id", kDocId);

        if (delErr) throw delErr;

        const rowsToInsert = newChunksData.map(c => ({
          document_id: kDocId,
          chunk_index: c.chunk_index,
          content: c.content,
          embedding: c.embedding
        }));

        const { error: insErr } = await supabase
          .from("knowledge_chunks")
          .insert(rowsToInsert);

        if (insErr) throw insErr;
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
