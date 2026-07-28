import { supabase } from "../config/supabase.js";

/**
 * Interface representing a matched document chunk retrieved from vector search.
 */
export interface MatchedDocument {
  id: string;
  document_id: string;
  chunk_index: number;
  content: string;
  similarity: number;
}

/**
 * Queries the database using cosine similarity (via RPC) to find the most relevant
 * document segments matching a query's embedding.
 *
 * @param embedding - Query embedding vector
 * @param limit - Maximum amount of results to retrieve (default 5)
 * @returns Array of matching document segments
 */
export async function searchKnowledge(
  embedding: number[],
  limit = 5
): Promise<MatchedDocument[]> {
  if (!embedding || embedding.length === 0) {
    throw new Error("O vetor de busca (embedding) não pode ser vazio.");
  }

  const { data, error } = await supabase.rpc("match_documents", {
    query_embedding: embedding,
    match_count: limit,
  });

  if (error) {
    throw new Error(`Erro ao realizar busca vetorial no Supabase RPC: ${error.message}`);
  }

  return (data as MatchedDocument[]) || [];
}
