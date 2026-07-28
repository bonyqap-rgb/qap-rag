import { supabase } from "../config/supabase.js";

/**
 * Saves a document's file name, chunk texts, and their respective embedding vectors to Supabase.
 * @param fileName Name of the uploaded file
 * @param chunks Array of text chunks
 * @param embeddings Array of number vectors
 * @returns The generated Document ID
 */
export async function saveKnowledge(
  fileName: string,
  chunks: string[],
  embeddings: number[][]
): Promise<string> {
  const { data: document, error: documentError } = await supabase
    .from("knowledge_documents")
    .insert({
      file_name: fileName,
    })
    .select()
    .single();

  if (documentError) throw documentError;

  const rows = chunks.map((chunk, index) => ({
    document_id: document.id,
    chunk_index: index,
    content: chunk,
    embedding: embeddings[index],
  }));

  const { error } = await supabase
    .from("knowledge_chunks")
    .insert(rows);

  if (error) throw error;

  return document.id;
}

/**
 * Searches the database using vector similarity (RPC match_documents) to retrieve matching document segments.
 * @param embedding Query embedding vector
 * @param limit Maximum results to return
 * @returns Array of matched document database rows
 */
export async function searchKnowledge(
  embedding: number[],
  limit = 5
): Promise<any[]> {
  const { data, error } = await supabase.rpc("match_documents", {
    query_embedding: embedding,
    match_count: limit,
  });

  if (error) {
    throw error;
  }

  return data || [];
}
