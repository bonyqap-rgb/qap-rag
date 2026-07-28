import { supabase } from "../config/supabase.js";

export interface SearchResult {
  id: string;
  document_id: string;
  chunk_index: number;
  content: string;
  similarity: number;
}

/**
 * Queries the Supabase vector database for matches, ranks them,
 * deduplicates retrieved chunks, and filters by similarity thresholds.
 *
 * @param embedding - Query embedding vector
 * @param limit - Maximum amount of chunks to retrieve (default 5)
 * @param similarityThreshold - Minimum similarity score (default 0.3)
 * @returns Filtered, ranked, and deduplicated search results
 */
export async function searchKnowledge(
  embedding: number[],
  limit = 5,
  similarityThreshold = 0.3
): Promise<SearchResult[]> {
  if (!embedding || embedding.length === 0) {
    throw new Error("Vetor de busca de embedding inválido ou vazio.");
  }

  // Request a slightly higher match count to compensate for deduplications during post-processing
  const rawLimit = limit * 2;

  const { data, error } = await supabase.rpc("match_documents", {
    query_embedding: embedding,
    match_count: rawLimit,
  });

  if (error) {
    throw new Error(`Erro na busca de documentos por RPC: ${error.message}`);
  }

  const results = (data as SearchResult[]) || [];

  const uniqueResults: SearchResult[] = [];
  const textKeys = new Set<string>();

  // Filter, Deduplicate and rank results
  for (const item of results) {
    // Skip if below the similarity threshold
    if (item.similarity < similarityThreshold) {
      continue;
    }

    // Extract raw text (ignoring metadata prefix if any) for pure textual deduplication
    let cleanText = item.content;
    const metaMatch = item.content.match(/^\[METADATA:[\s\S]*?\]\n([\s\S]*)$/);
    if (metaMatch) {
      cleanText = metaMatch[1];
    }

    const key = cleanText.trim().toLowerCase();
    if (!textKeys.has(key)) {
      textKeys.add(key);
      uniqueResults.push(item);
    }

    // Cease processing once the requested limit is satisfied
    if (uniqueResults.length >= limit) {
      break;
    }
  }

  // Ensure results are strictly ordered by relevance (similarity descending)
  return uniqueResults.sort((a, b) => b.similarity - a.similarity);
}
