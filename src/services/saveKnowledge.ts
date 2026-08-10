import { supabase } from "../config/supabase.js";
import { indexingHistoryService } from "./indexing-history.service.js";

/**
 * Executes a function with exponential backoff retries for database insertion robustness.
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  retries = 3,
  delayMs = 1000
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error: any) {
      attempt++;
      if (attempt >= retries) {
        throw error;
      }
      const backoffDelay = delayMs * Math.pow(2, attempt - 1);
      console.warn(`[DB RETRY] Tentativa ${attempt} falhou. Retentando em ${backoffDelay}ms... Erro: ${error.message || error}`);
      await new Promise((resolve) => setTimeout(resolve, backoffDelay));
    }
  }
}

/**
 * Parses page markers, builds a normalized metadata block, inserts the document,
 * saves deduplicated chunks, validates indexation metrics, updates document status,
 * and outputs structured pipeline logs.
 *
 * @param fileName - Original PDF document name
 * @param rawChunks - Chunks containing embedded page markers
 * @param embeddings - Generated embedding vectors corresponding to chunks
 * @returns Saved Document ID
 */
export async function saveKnowledge(
  fileName: string,
  rawChunks: string[],
  embeddings: number[][],
  targetDocumentId?: string
): Promise<string> {
  if (!fileName) throw new Error("O nome do arquivo não foi informado.");

  const startTime = performance.now();
  const timestamp = new Date().toISOString();

  let charsCount = 0;
  let chunksCount = 0;
  let embeddingsCount = 0;
  let persisted = "NÃO";
  let finalStatus = "INDEXAÇÃO_INVÁLIDA";

  let documentId: string;
  let existingDoc: any = null;

  // 1. Resolve existing document metadata row to prevent double records
  if (targetDocumentId) {
    const { data } = await supabase
      .from("knowledge_documents")
      .select("id, status")
      .eq("id", targetDocumentId)
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

    // remover chunks antigos e remover embeddings antigos
    await supabase
      .from("knowledge_chunks")
      .delete()
      .eq("document_id", documentId);

    // remover metadados antigos e atualizar status para PROCESSANDO
    const docUpdateCall = async () => {
      const { data: document, error: documentError } = await supabase
        .from("knowledge_documents")
        .update({
          status: "PROCESSANDO",
          total_chunks: 0,
          total_embeddings: 0,
          extracted_chars: 0,
          updated_at: timestamp
        })
        .eq("id", documentId)
        .select()
        .single();

      if (documentError) throw documentError;
      return document;
    };

    await retryWithBackoff(docUpdateCall, 3, 1000);
  } else {
    // Insert the document metadata row with retries in PROCESSANDO status
    const docInsertCall = async () => {
      const { data: document, error: documentError } = await supabase
        .from("knowledge_documents")
        .insert({
          file_name: fileName,
          status: "PROCESSANDO",
          updated_at: timestamp
        })
        .select()
        .single();

      if (documentError) throw documentError;
      return document;
    };

    const document = await retryWithBackoff(docInsertCall, 3, 1000);
    documentId = document.id;
  }

  try {
    const processedChunks: { text: string; embedding: number[]; page: number }[] = [];

    if (rawChunks && rawChunks.length > 0) {
      for (let i = 0; i < rawChunks.length; i++) {
        const rawChunk = rawChunks[i] ?? "";
        let pageNum = 1;
        let cleanText = rawChunk;

        // Detect and parse the page marker tag
        const pageMatch = rawChunk.match(/^\[PAGE:(\d+)\]\s*([\s\S]*)$/);
        if (pageMatch) {
          pageNum = parseInt(pageMatch[1], 10);
          cleanText = (pageMatch[2] ?? "").trim();
        }

        // Skip duplicates
        const isDuplicate = processedChunks.some(
          (pc) => (pc?.text ?? "").toLowerCase() === (cleanText ?? "").toLowerCase()
        );

        if (isDuplicate) {
          console.log(`[DEDUPLICATE] Pulando trecho duplicado no documento: "${cleanText.substring(0, 30)}..."`);
          continue;
        }

        processedChunks.push({
          text: cleanText,
          embedding: embeddings[i],
          page: pageNum,
        });
      }
    }

    chunksCount = processedChunks.length;
    embeddingsCount = processedChunks.filter(pc => pc.embedding && pc.embedding.length > 0).length;
    charsCount = processedChunks.reduce((sum, pc) => sum + (pc.text?.length || 0), 0);

    // If we have valid chunks and embeddings, persist them
    if (chunksCount > 0 && embeddingsCount === chunksCount) {
      // Clean old chunks
      await supabase
        .from("knowledge_chunks")
        .delete()
        .eq("document_id", documentId);

      const rows = processedChunks.map((pc, index) => {
        const metadataHeader = JSON.stringify({
          sourceDocument: fileName,
          pageNumber: pc.page,
          chunkIndex: index,
          totalChunks: chunksCount,
          createdAt: timestamp,
        });

        const enrichedContent = `[METADATA:${metadataHeader}]\n${pc.text}`;

        const targetDimension = 1536;
        let finalChunkEmbedding = pc.embedding ? [...pc.embedding] : [];
        if (finalChunkEmbedding.length !== targetDimension) {
          if (finalChunkEmbedding.length > targetDimension) {
            finalChunkEmbedding = finalChunkEmbedding.slice(0, targetDimension);
          } else {
            while (finalChunkEmbedding.length < targetDimension) {
              finalChunkEmbedding.push(0);
            }
          }
        }

        return {
          document_id: documentId,
          chunk_index: index,
          content: enrichedContent,
          embedding: finalChunkEmbedding,
        };
      });

      // Batch insertion of chunk rows to avoid payload limit and timeout issues
      const batchSize = 50;
      let insertedAllBatches = true;

      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        const chunkInsertCall = async () => {
          const { error } = await supabase
            .from("knowledge_chunks")
            .insert(batch);

          if (error) throw error;
        };

        try {
          await retryWithBackoff(chunkInsertCall, 3, 1000);
        } catch (batchErr: any) {
          console.error(`[SAVE KNOWLEDGE] Falha ao inserir lote de chunks (índice ${i}):`, batchErr);
          insertedAllBatches = false;
          throw batchErr;
        }
      }

      // Verify persistence
      const { count: dbChunksCount, error: countErr } = await supabase
        .from("knowledge_chunks")
        .select("*", { count: "exact", head: true })
        .eq("document_id", documentId);

      if (!countErr && dbChunksCount === chunksCount && dbChunksCount > 0 && insertedAllBatches) {
        persisted = "SIM";
      }
    }

    // Strict validation of indexing
    if (charsCount > 0 && chunksCount > 0 && embeddingsCount > 0 && persisted === "SIM") {
      finalStatus = "INDEXADO";
    } else {
      finalStatus = "INDEXAÇÃO_INVÁLIDA";
    }

  } catch (err: any) {
    console.error(`[SAVE KNOWLEDGE ERROR] ${err.message || err}`);
    finalStatus = "INDEXAÇÃO_INVÁLIDA";
    persisted = "NÃO";
  } finally {
    // Print the exact requested logs format with down arrows ↓
    console.log(`Documento: ${fileName}`);
    console.log(`↓`);
    console.log(`Caracteres extraídos: ${charsCount}`);
    console.log(`↓`);
    console.log(`Chunks: ${chunksCount}`);
    console.log(`↓`);
    console.log(`Embeddings: ${embeddingsCount}`);
    console.log(`↓`);
    console.log(`Persistido?: ${persisted}`);
    console.log(`↓`);
    console.log(`Status final: ${finalStatus}`);

    // Update document record with final status and metadata in the database
    await supabase
      .from("knowledge_documents")
      .update({
        status: finalStatus,
        total_chunks: chunksCount,
        total_embeddings: embeddingsCount,
        extracted_chars: charsCount,
        updated_at: timestamp
      })
      .eq("id", documentId);

    const duration = Math.round(performance.now() - startTime);

    await indexingHistoryService.record({
      document: fileName,
      date: timestamp,
      duration,
      chunks_count: chunksCount,
      embeddings_count: embeddingsCount,
      success: finalStatus === "INDEXADO",
      error_message: finalStatus === "INDEXADO" ? undefined : "Indexação inválida ou falha no processamento."
    });

    if (finalStatus !== "INDEXADO") {
      throw new Error(`INDEXAÇÃO_INVÁLIDA: Falha na validação final dos registros persistidos.`);
    }
  }

  return documentId;
}
