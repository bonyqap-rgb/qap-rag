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
  storagePath?: string
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
  const { data: existingDoc, error: existingDocError } = await supabase
    .from("knowledge_documents")
    .select("id, status, storage_path")
    .eq("file_name", fileName)
    .maybeSingle();

  let documentId: string;
  const finalStoragePath = storagePath || existingDoc?.storage_path || null;

  if (existingDoc) {
    documentId = existingDoc.id;

    // IMPORTANT: Do NOT delete old chunks here. Keep them safe until the new ones are generated and successfully verified!

    // Atualizar status para PROCESSANDO sem apagar os chunks válidos ainda
    const docUpdateCall = async () => {
      const { data: document, error: documentError } = await supabase
        .from("knowledge_documents")
        .update({
          status: "PROCESSANDO",
          storage_path: finalStoragePath,
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
          storage_path: finalStoragePath,
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

      const chunkInsertCall = async () => {
        // Enforce database-level atomicity by using update_document_chunks_transaction RPC.
        // This guarantees a single, ACID transaction inside PostgreSQL. If any insert fails,
        // the entire delete is rolled back, leaving the old valid chunks perfectly untouched!
        const rpcRows = rows.map(r => ({
          chunk_index: r.chunk_index,
          content: r.content,
          embedding: r.embedding
        }));

        const { error: rpcErr } = await supabase.rpc("update_document_chunks_transaction", {
          p_k_doc_id: documentId,
          p_chunks_data: rpcRows
        });

        if (rpcErr) {
          throw new Error(`Erro na transação de atualização de chunks do documento (RPC update_document_chunks_transaction falhou): ${rpcErr.message || JSON.stringify(rpcErr)}`);
        }
      };

      await retryWithBackoff(chunkInsertCall, 3, 1000);

      // Verify persistence and validate embeddings are non-null and exactly 1536 size
      const { data: dbChunks, error: countErr } = await supabase
        .from("knowledge_chunks")
        .select("id, embedding")
        .eq("document_id", documentId);

      if (!countErr && dbChunks && dbChunks.length === chunksCount && dbChunks.length > 0) {
        const allEmbeddingsValid = dbChunks.every(
          (c) => c.embedding && Array.isArray(c.embedding) && c.embedding.length === 1536
        );
        if (allEmbeddingsValid) {
          persisted = "SIM";
        } else {
          console.error(`[SAVE KNOWLEDGE] Erro de validação: Chunks persistidos possuem embeddings inválidos ou dimensão diferente de 1536.`);
          persisted = "NÃO";
        }
      } else {
        if (countErr) {
          console.error(`[SAVE KNOWLEDGE] Erro ao buscar chunks persistidos para validação: ${countErr.message}`);
        } else {
          console.error(`[SAVE KNOWLEDGE] Erro de contagem: esperava ${chunksCount} chunks persistidos, mas encontrou ${dbChunks?.length || 0}.`);
        }
        persisted = "NÃO";
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
        storage_path: finalStoragePath,
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
