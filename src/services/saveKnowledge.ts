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
 * @param documentIdParam - Optional pre-registered document ID
 * @returns Saved Document ID
 */
export async function saveKnowledge(
  fileName: string,
  rawChunks: string[],
  embeddings: number[][],
  documentIdParam?: string
): Promise<string> {
  if (!fileName) throw new Error("O nome do arquivo não foi informado.");

  const startTime = performance.now();
  const timestamp = new Date().toISOString();

  let charsCount = 0;
  let chunksCount = 0;
  let embeddingsCount = 0;
  let persisted = "NÃO";
  let finalStatus = "INDEXAÇÃO_INVÁLIDA";

  // 1. Check if the document already exists in the database to support safe, clean reindexing
  let existingDoc = null;

  if (documentIdParam) {
    const { data, error } = await supabase
      .from("knowledge_documents")
      .select("id, status")
      .eq("id", documentIdParam)
      .maybeSingle();
    if (!error && data) {
      existingDoc = data;
    }
  }

  if (!existingDoc) {
    const { data, error } = await supabase
      .from("knowledge_documents")
      .select("id, status")
      .eq("file_name", fileName)
      .maybeSingle();
    if (!error && data) {
      existingDoc = data;
    }
  }

  let finalDocumentId: string;

  if (existingDoc) {
    finalDocumentId = existingDoc.id;

    // remover chunks antigos e remover embeddings antigos
    await supabase
      .from("knowledge_chunks")
      .delete()
      .eq("document_id", finalDocumentId);

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
        .eq("id", finalDocumentId)
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
    finalDocumentId = document.id;
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
        .eq("document_id", finalDocumentId);

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
          document_id: finalDocumentId,
          chunk_index: index,
          content: enrichedContent,
          embedding: finalChunkEmbedding,
        };
      });

      const BATCH_SIZE = 50;
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        console.log(`[SAVE KNOWLEDGE] Gravando lote de chunks ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(rows.length / BATCH_SIZE)} (tamanho: ${batch.length})...`);

        const chunkInsertCall = async () => {
          const { error } = await supabase
            .from("knowledge_chunks")
            .insert(batch);

          if (error) throw error;
        };

        await retryWithBackoff(chunkInsertCall, 3, 1000);
      }

      // Verify persistence
      const { count: dbChunksCount, error: countErr } = await supabase
        .from("knowledge_chunks")
        .select("*", { count: "exact", head: true })
        .eq("document_id", finalDocumentId);

      if (!countErr && dbChunksCount === chunksCount && dbChunksCount > 0) {
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
      .eq("id", finalDocumentId);

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

  return finalDocumentId;
}
