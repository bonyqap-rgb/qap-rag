import { supabase } from "../config/supabase.js";

/**
 * Saves document metadata and its corresponding chunked text sections with their generated
 * embedding vectors into the Supabase database.
 *
 * @param fileName - Original name of the document file
 * @param chunks - Extracted and sliced text chunks of the document
 * @param embeddings - Corresponding array of high-dimensional embedding vectors
 * @returns The unique identifier of the newly saved document in the database
 */
export async function saveKnowledge(
  fileName: string,
  chunks: string[],
  embeddings: number[][]
): Promise<string> {
  if (!fileName) throw new Error("O nome do arquivo não foi fornecido.");
  if (!chunks || chunks.length === 0) throw new Error("A lista de trechos (chunks) está vazia.");
  if (!embeddings || embeddings.length !== chunks.length) {
    throw new Error("A quantidade de embeddings não corresponde à quantidade de trechos.");
  }

  // 1. Insert metadata row into knowledge_documents table
  const { data: document, error: documentError } = await supabase
    .from("knowledge_documents")
    .insert({
      file_name: fileName,
    })
    .select()
    .single();

  if (documentError) {
    throw new Error(`Erro ao salvar metadados do documento: ${documentError.message}`);
  }

  // 2. Prepare the bulk database rows for knowledge_chunks table
  const rows = chunks.map((chunk, index) => ({
    document_id: document.id,
    chunk_index: index,
    content: chunk,
    embedding: embeddings[index],
  }));

  // 3. Insert chunks and embeddings in bulk
  const { error: chunkError } = await supabase
    .from("knowledge_chunks")
    .insert(rows);

  if (chunkError) {
    throw new Error(`Erro ao salvar trechos do documento no Supabase: ${chunkError.message}`);
  }

  return document.id;
}
