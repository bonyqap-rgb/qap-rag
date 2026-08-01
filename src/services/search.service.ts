import { supabase } from "../config/supabase.js";
import { env } from "../config/env.js";
import { createEmbedding } from "../groq/embed.js";
import { logger } from "./logger.service.js";
import { metricsService } from "./metrics.service.js";

export interface SearchFilters {
  documentId?: string;
  category?: string;
  documentType?: string;
}

export interface SearchResultItem {
  documentId: string;
  chunkIndex: number;
  score: number;
  text: string;
}

export class SearchService {
  /**
   * Performs semantic search using pgvector.
   *
   * @param queryText - Search question
   * @param topK - Maximum number of results (default env.DEFAULT_TOP_K)
   * @param scoreThreshold - Minimum similarity score (default env.DEFAULT_MIN_SCORE)
   * @param filters - Optional filters (documentId, category, documentType)
   * @returns List of matching results sorted by similarity descending
   */
  static async search(
    queryText: string,
    topK: number = env.DEFAULT_TOP_K,
    scoreThreshold: number = env.DEFAULT_MIN_SCORE,
    filters?: SearchFilters
  ): Promise<SearchResultItem[]> {
    const startTime = performance.now();

    // Increment searches metric
    metricsService.incrementSearches();

    if (!queryText || typeof queryText !== "string" || queryText.trim() === "") {
      throw new Error("O texto de busca não pode ser vazio.");
    }

    // 1. Resolve metadata filters
    let activeDocumentIdFilters: string[] | null = null;

    // Combine with specific documentId filter if provided
    if (filters?.documentId) {
      activeDocumentIdFilters = [filters.documentId];
    }

    // 2. Generate embedding for query text (leverages caching and retries internally)
    const embedding = await createEmbedding(queryText);

    // Enforce 1536-dimensional vectors and log dimension sent to RPC
    const targetDimension = 1536;
    let finalEmbedding = [...embedding];
    if (finalEmbedding.length !== targetDimension) {
      console.warn(`[SEARCH] Dimensão do embedding gerado é incorreta: ${finalEmbedding.length}. Forçando ajuste para ${targetDimension}...`);
      if (finalEmbedding.length > targetDimension) {
        finalEmbedding = finalEmbedding.slice(0, targetDimension);
      } else {
        while (finalEmbedding.length < targetDimension) {
          finalEmbedding.push(0);
        }
      }
    }
    console.log(`[SEARCH] dimensão enviada para a RPC do Supabase: ${finalEmbedding.length}`);

    // 3. Query pgvector via match_documents RPC with slightly higher limit to handle post-filtering deduplication
    const rawLimit = Math.max(topK * 2, 20);

    let dbQuery = supabase.rpc("match_documents", {
      query_embedding: finalEmbedding,
      match_count: rawLimit,
    });

    if (activeDocumentIdFilters !== null) {
      if (activeDocumentIdFilters.length === 1) {
        dbQuery = dbQuery.eq("document_id", activeDocumentIdFilters[0]);
      } else {
        dbQuery = dbQuery.in("document_id", activeDocumentIdFilters);
      }
    }

    const { data: rawResults, error: rpcError } = await dbQuery;

    if (rpcError) {
      throw new Error(`Erro na busca vetorial por RPC: ${rpcError.message}`);
    }

    const results = (rawResults as any[]) || [];

    // 4. Post-process: extract clean text, parse metadata, deduplicate and apply threshold
    const uniqueResults: SearchResultItem[] = [];
    const seenTexts = new Set<string>();

    for (const item of results) {
      const score = item.similarity ?? 0;

      // Skip if below similarity threshold
      if (score < scoreThreshold) {
        continue;
      }

      // Extract clean text and parse embedded metadata block
      let cleanText = item.content || "";
      const metaMatch = cleanText.match(/^\[METADATA:[\s\S]*?\]\n([\s\S]*)$/);
      if (metaMatch) {
        cleanText = metaMatch[1];
      }

      cleanText = cleanText.trim();
      const textKey = (cleanText ?? "").toLowerCase();

      // Deduplicate
      if (!seenTexts.has(textKey)) {
        seenTexts.add(textKey);
        uniqueResults.push({
          documentId: item.document_id,
          chunkIndex: item.chunk_index ?? 0,
          score,
          text: cleanText,
        });
      }

      if (uniqueResults.length >= topK) {
        break;
      }
    }

    // Ensure results are strictly ordered by relevance (score descending)
    uniqueResults.sort((a, b) => b.score - a.score);

    // 5. Compute metrics and structured log
    const durationMs = performance.now() - startTime;
    const count = uniqueResults.length;
    const avgScore = count > 0 ? uniqueResults.reduce((sum, r) => sum + r.score, 0) / count : 0;
    const consultedDocIds = Array.from(new Set(uniqueResults.map((r) => r.documentId)));

    this.logSearch(durationMs, count, avgScore, consultedDocIds);

    return uniqueResults;
  }

  /**
   * Structure and emit search operation log details safely.
   */
  private static logSearch(
    durationMs: number,
    count: number,
    averageScore: number,
    consultedDocuments: string[]
  ): void {
    logger.info("Busca semântica realizada com sucesso", {
      searchDurationMs: parseFloat(durationMs.toFixed(2)),
      resultsCount: count,
      averageScore: parseFloat(averageScore.toFixed(4)),
      consultedDocuments,
    });
  }
}
