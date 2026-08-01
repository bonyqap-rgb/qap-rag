import { supabase } from "../config/supabase.js";

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
 * Parses page markers, builds a normalized metadata block, and inserts the document
 * and deduplicated chunks with nested metadata headers into the Supabase tables.
 *
 * @param fileName - Original PDF document name
 * @param rawChunks - Chunks containing embedded page markers
 * @param embeddings - Generated embedding vectors corresponding to chunks
 * @returns Saved Document ID
 */
export async function saveKnowledge(
  fileName: string,
  rawChunks: string[],
  embeddings: number[][]
): Promise<string> {
  if (!fileName) throw new Error("O nome do arquivo não foi informado.");
  if (!rawChunks || rawChunks.length === 0) throw new Error("Nenhum trecho de texto fornecido.");

  // Process and build standard metadata headers into chunks
  const processedChunks: { text: string; embedding: number[]; page: number }[] = [];
  const timestamp = new Date().toISOString();

  for (let i = 0; i < rawChunks.length; i++) {
    const rawChunk = rawChunks[i];
    let pageNum = 1;
    let cleanText = rawChunk;

    // Detect and parse the page marker tag
    const pageMatch = rawChunk.match(/^\[PAGE:(\d+)\]\s*([\s\S]*)$/);
    if (pageMatch) {
      pageNum = parseInt(pageMatch[1], 10);
      cleanText = pageMatch[2].trim();
    }

    // Skip duplicates - check if this clean text is already added in this document upload
    const isDuplicate = processedChunks.some(
      (pc) => (pc.text ?? "").toLowerCase() === (cleanText ?? "").toLowerCase()
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

  // 1. Insert the document metadata row with retries
  const docInsertCall = async () => {
    const { data: document, error: documentError } = await supabase
      .from("knowledge_documents")
      .insert({
        file_name: fileName,
      })
      .select()
      .single();

    if (documentError) throw documentError;
    return document;
  };

  const document = await retryWithBackoff(docInsertCall, 3, 1000);
  const totalChunks = processedChunks.length;

  // 2. Prepare structured data payload for batch insert
  const rows = processedChunks.map((pc, index) => {
    // Standardize structured metadata header embedded inside content string for seamless retrieval
    const metadataHeader = JSON.stringify({
      sourceDocument: fileName,
      pageNumber: pc.page,
      chunkIndex: index,
      totalChunks,
      createdAt: timestamp,
    });

    const enrichedContent = `[METADATA:${metadataHeader}]\n${pc.text}`;

    // Enforce 1536-dimensional vectors for perfect pgvector compatibility
    const targetDimension = 1536;
    let finalChunkEmbedding = pc.embedding ? [...pc.embedding] : [];
    if (finalChunkEmbedding.length !== targetDimension) {
      console.warn(`[SAVE KNOWLEDGE] Chunk ${index} com dimensão de embedding incorreta: ${finalChunkEmbedding.length}. Corrigindo...`);
      if (finalChunkEmbedding.length > targetDimension) {
        finalChunkEmbedding = finalChunkEmbedding.slice(0, targetDimension);
      } else {
        while (finalChunkEmbedding.length < targetDimension) {
          finalChunkEmbedding.push(0);
        }
      }
    }

    return {
      document_id: document.id,
      chunk_index: index,
      content: enrichedContent,
      embedding: finalChunkEmbedding,
    };
  });

  // 3. Batch insert database rows with retry logic
  const chunkInsertCall = async () => {
    if (rows.length > 0) {
      console.log(`[SAVE KNOWLEDGE] dimensão enviada para o Supabase (insert): ${rows[0].embedding?.length}`);
    }
    const { error } = await supabase
      .from("knowledge_chunks")
      .insert(rows);

    if (error) throw error;
  };

  await retryWithBackoff(chunkInsertCall, 3, 1000);

  return document.id;
}
