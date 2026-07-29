import { DocumentService } from "../document.service.js";
import { ChunkerService } from "../chunker/chunker.service.js";
import { EmbeddingService } from "../embedding/embedding.service.js";
import { VectorService } from "../vector/vector.service.js";
import { logger } from "../logger.service.js";

export class IndexerService {
  private documentService: DocumentService;
  private chunkerService: ChunkerService;
  private embeddingService: EmbeddingService;
  private vectorService: VectorService;

  constructor(
    documentService = new DocumentService(),
    chunkerService = new ChunkerService(),
    embeddingService = new EmbeddingService(),
    vectorService = new VectorService()
  ) {
    this.documentService = documentService;
    this.chunkerService = chunkerService;
    this.embeddingService = embeddingService;
    this.vectorService = vectorService;
  }

  /**
   * Executes the complete indexing pipeline for a document already registered in the DB.
   *
   * @param documentId - The UUID of the document to index
   */
  async indexDocument(documentId: string): Promise<void> {
    const pipelineStart = Date.now();
    let documentTitle = "Desconhecido";
    let chunkCount = 0;
    let chunkingDuration = 0;
    let embeddingDuration = 0;

    try {
      // 1. Fetch document and set status to 'processing'
      const doc = await this.documentService.getDocumentById(documentId);
      documentTitle = doc.title;

      logger.info(`[INDEXER] Iniciando pipeline de indexação para documento. ID: ${documentId}, Título: ${documentTitle}`);

      await this.documentService.updateDocument(documentId, {
        processingStatus: "processing",
      });

      // 2. Validate and retrieve extracted text
      const text = doc.extractedText;
      if (!text || text.trim() === "") {
        throw new Error("O documento não possui texto extraído ('extractedText') para indexação.");
      }

      // 3. Segment text into chunks
      const chunkingStart = Date.now();
      const chunks = this.chunkerService.splitText(text);
      chunkingDuration = Date.now() - chunkingStart;
      chunkCount = chunks.length;

      logger.info(`[INDEXER] Chunking concluído. ID: ${documentId}, Chunks: ${chunkCount}, Tempo: ${chunkingDuration}ms`);

      if (chunkCount === 0) {
        throw new Error("Nenhum chunk foi gerado a partir do texto extraído.");
      }

      // 4. Generate embeddings for each chunk
      const embeddingStart = Date.now();
      const embeddings: number[][] = [];

      // We process sequentially for safety and rate-limit friendliness, prepared for future parallelization
      for (const chunk of chunks) {
        const vector = await this.embeddingService.generateEmbedding(chunk);
        embeddings.push(vector);
      }
      embeddingDuration = Date.now() - embeddingStart;

      logger.info(`[INDEXER] Geração de embeddings concluída. ID: ${documentId}, Tempo: ${embeddingDuration}ms`);

      // 5. Store chunk vectors in Supabase pgvector
      const vectorStart = Date.now();
      const chunksToSave = chunks.map((chunkText, idx) => ({
        documentId,
        chunkIndex: idx,
        texto: chunkText,
        embedding: embeddings[idx],
      }));

      await this.vectorService.saveChunks(chunksToSave);
      const vectorDuration = Date.now() - vectorStart;

      logger.info(`[INDEXER] Salvamento vetorial concluído. ID: ${documentId}, Tempo: ${vectorDuration}ms`);

      // 6. Update status to 'indexed'
      await this.documentService.updateDocument(documentId, {
        processingStatus: "indexed",
      });

      const totalDuration = Date.now() - pipelineStart;

      // Log complete indexing stats
      logger.info(`[INDEXER] Documento indexado com sucesso!`, {
        documentId,
        documentTitle,
        chunkCount,
        chunkingDurationMs: chunkingDuration,
        embeddingDurationMs: embeddingDuration,
        vectorDurationMs: vectorDuration,
        totalDurationMs: totalDuration,
      });

    } catch (error: any) {
      const totalDuration = Date.now() - pipelineStart;
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Log detailed error and pipeline stats
      logger.error(`[INDEXER] Falha na pipeline de indexação para o documento ID: ${documentId}`, {
        documentId,
        documentTitle,
        error: errorMsg,
        stack: error instanceof Error ? error.stack : undefined,
        chunkCount,
        chunkingDurationMs: chunkingDuration,
        embeddingDurationMs: embeddingDuration,
        totalDurationMs: totalDuration,
      });

      try {
        // Attempt to update document status to 'failed'
        await this.documentService.updateDocument(documentId, {
          processingStatus: "failed",
        });
      } catch (updateError: any) {
        logger.error(`[INDEXER] Erro ao atualizar status do documento ID: ${documentId} para 'failed'`, {
          error: updateError instanceof Error ? updateError.message : String(updateError),
        });
      }

      throw error;
    }
  }
}
