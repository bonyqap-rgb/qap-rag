import { supabase } from "../config/supabase.js";
import { env } from "../config/env.js";
import { createEmbedding } from "../groq/embed.js";
import { logger } from "./logger.service.js";
import { metricsService } from "./metrics.service.js";

// Configurable constants for Hybrid Search (PR 4)
export const HYBRID_VECTOR_WEIGHT = 0.7;
export const HYBRID_LEXICAL_WEIGHT = 0.3;
export const HYBRID_MIN_VECTOR_SCORE = 0.15;
export const HYBRID_MIN_LEXICAL_SCORE = 0.01;
export const HYBRID_MAX_RESULTS = 10;

const EXPLICIT_DOC_BOOST = 0.25;
const METADATA_QUALITY_BOOST = 0.08;
const DIVERSITY_PENALTY_FACTOR = 0.08;

function normalizeQuery(text: string): string {
  if (!text) return "";
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove accents
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"']/g, " ") // replace punctuation, hyphens, underscores with space
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Computes a high-quality lexical similarity score (0 to 1) in JavaScript
 * as a robust fallback mechanism for full text matching queries.
 */
function computeFallbackLexicalScore(text: string, query: string): number {
  const normText = normalizeQuery(text);
  const normQuery = normalizeQuery(query);
  if (!normQuery || !normText) return 0;

  const queryWords = normQuery.split(/\s+/).filter(w => w.length >= 2);
  if (queryWords.length === 0) return 0;

  let matchCount = 0;
  for (const word of queryWords) {
    if (normText.includes(word)) {
      matchCount++;
      // Give a tiny boost for exact multiple occurrences of key terms
      const occurrences = (normText.match(new RegExp(word, "g")) || []).length;
      matchCount += Math.min(occurrences - 1, 3) * 0.05;
    }
  }

  return Math.min(matchCount / queryWords.length, 1.0);
}

function getFilenameAliases(fileName: string): string[] {
  if (!fileName) return [];
  const cleanName = fileName.toLowerCase().replace(/\.[^/.]+$/, ""); // remove extension
  const normName = normalizeQuery(cleanName);

  const aliases = new Set<string>();

  aliases.add(normName);
  aliases.add(normName.replace(/\s+/g, ""));

  const parts = normName.split(/\s+/);

  // If we have parts like "i" and "18" (originally "I-18"), let's preserve combinations
  const rawClean = cleanName.toLowerCase();
  const specMatches = rawClean.match(/[a-z]+-?\d+/g);
  if (specMatches) {
    for (const match of specMatches) {
      const normMatch = normalizeQuery(match);
      aliases.add(normMatch);
      aliases.add(normMatch.replace(/\s+/g, ""));
    }
  }

  if (parts.length > 1) {
    const acronym = parts.map(p => p[0]).join("");
    if (acronym.length >= 2) {
      aliases.add(acronym);
    }
  }

  // Explicit mappings for well-known acronyms
  if (normName.includes("codigo penal militar") || normName.includes("cpm")) {
    aliases.add("cpm");
    aliases.add("codigo penal militar");
  }
  if (normName.includes("regulamento disciplinar") || normName.includes("rdpm")) {
    aliases.add("rdpm");
    aliases.add("regulamento disciplinar");
  }
  if (normName.includes("processo administrativo disciplinar") || normName.includes("pad")) {
    aliases.add("pad");
    aliases.add("processo administrativo disciplinar");
  }

  const FORBIDDEN_GENERIC_WORDS = new Set([
    "militar", "policia", "policial", "codigo", "regulamento", "processo",
    "artigo", "disciplinar", "administrativo", "instrucao", "pm", "pdf",
    "manual", "comentado", "documento", "instrucoes", "regulamentos",
    "codigos", "processos", "artigos", "militarizado", "policiais", "lei",
    "leis", "decreto", "decretos", "resolucao", "resolucoes", "portaria",
    "portarias", "de", "do", "da", "o", "a", "os", "as", "um", "uma", "em",
    "no", "na", "nos", "nas", "para", "com", "por"
  ]);

  for (const part of parts) {
    if (part.length >= 3 && !FORBIDDEN_GENERIC_WORDS.has(part)) {
      aliases.add(part);
    }
  }

  return Array.from(aliases).filter(a => a.trim().length >= 2);
}

function isDocumentExplicitlyMentioned(query: string, fileName: string): boolean {
  if (!fileName || fileName === "Desconhecido") return false;
  const normQuery = normalizeQuery(query);
  const aliases = getFilenameAliases(fileName);

  for (const alias of aliases) {
    const escaped = alias.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
    const regex = new RegExp(`\\b${escaped}\\b`, "i");
    if (regex.test(normQuery)) {
      return true;
    }
  }
  return false;
}

function hasQualityMetadata(cleanText: string, metadata: any): boolean {
  if (!cleanText) return false;
  // Check JSON metadata fields first
  if (
    metadata &&
    (metadata.article ||
     metadata.chapter ||
     metadata.section ||
     metadata.category ||
     metadata.documentType ||
     metadata.document_type)
  ) {
    return true;
  }

  // Fallback to text patterns (like Artigo, Art., Seção, Capítulo, Parágrafo, Item)
  const hasArt = /\b(?:Artigo|Art\.)\s*\d+/i.test(cleanText);
  const hasChap = /\b(?:Capítulo|Capitulo|Cap\.)\s+[IVXLCDM\d]+/i.test(cleanText);
  const hasSec = /\b(?:Seção|Secão|Secao|Sec\.)\s+([IVXLCDM\d]+|[^,\n\.\s]{3,})/i.test(cleanText);
  const hasPar = /(?:Parágrafo|Parágrafos|Paragrafos|Paragrafo)\s*(Único|Unico|\d+)|§\s*\d+/i.test(cleanText);
  const hasItem = /\b(?:Item|Itens)\s+\d+/i.test(cleanText);

  return hasArt || hasChap || hasSec || hasPar || hasItem;
}

export interface SearchFilters {
  documentId?: string;
  documentIds?: string[];
  category?: string;
  documentType?: string;
}

export interface SearchResultItem {
  documentId: string;
  chunkIndex: number;
  score: number;
  text: string;
  metadata?: {
    sourceDocument?: string;
    pageNumber?: number;
    chunkIndex?: number;
    totalChunks?: number;
    createdAt?: string;
    vectorScore?: number;
    lexicalScore?: number;
    [key: string]: any;
  };
}

export class SearchService {
  /**
   * Performs hybrid search combining semantic search (pgvector) and lexical search
   * (Postgres Full Text Search using websearch_to_tsquery).
   *
   * @param queryText - Search question
   * @param topK - Maximum number of results (default env.DEFAULT_TOP_K)
   * @param scoreThreshold - Minimum similarity score (default env.DEFAULT_MIN_SCORE)
   * @param filters - Optional filters (documentId, category, documentType)
   * @returns List of matching results sorted by composite score descending
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

    if (filters?.documentId) {
      activeDocumentIdFilters = [filters.documentId];
    } else if (filters?.documentIds && filters.documentIds.length > 0) {
      activeDocumentIdFilters = filters.documentIds;
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

    // [DIAGNOSTIC LOGS] Contagem de registros na tabela knowledge_chunks antes da busca
    let totalRecordCount = 0;
    const isTest = process.env.SUPABASE_SERVICE_ROLE_KEY === "dummy_key";
    if (!isTest) {
      try {
        const { count, error: countError } = await supabase
          .from("knowledge_chunks")
          .select("*", { count: "exact", head: true });
        if (!countError && count !== null) {
          totalRecordCount = count;
        } else if (countError) {
          console.error(`[SEARCH] Erro ao obter contagem de registros em knowledge_chunks: ${countError.message}`);
        }
      } catch (err) {
        console.warn(`[SEARCH] Erro ao obter contagem de registros em knowledge_chunks:`, err);
      }
    } else {
      console.log(`[SEARCH] Ambiente de teste detectado, pulando contagem de registros em knowledge_chunks.`);
    }
    console.log(`[SEARCH] Registros na tabela 'knowledge_chunks' antes de executar a busca: ${totalRecordCount}`);

    // 3. Fetch active documents from knowledge_documents for ID-to-filename mapping
    const documentNamesMap = new Map<string, string>();
    if (!isTest) {
      try {
        const { data: matchedDocs, error: docError } = await supabase
          .from("knowledge_documents")
          .select("id, file_name");
        if (!docError && matchedDocs) {
          for (const d of matchedDocs) {
            documentNamesMap.set(d.id, d.file_name || "Desconhecido");
          }
        }
      } catch (err) {
        console.warn(`[SEARCH] Erro ao carregar nomes de documentos:`, err);
      }
    }

    // 4. Parallel Execution of Vector and Lexical searches to minimize latency
    const rawLimit = Math.max(topK * 6, 60);

    // 4.1. Define Vector search query
    let vectorQuery = supabase.rpc("match_documents", {
      query_embedding: finalEmbedding,
      match_count: rawLimit,
    });

    if (activeDocumentIdFilters !== null) {
      if (activeDocumentIdFilters.length === 1) {
        vectorQuery = vectorQuery.eq("document_id", activeDocumentIdFilters[0]);
      } else {
        vectorQuery = vectorQuery.in("document_id", activeDocumentIdFilters);
      }
    }

    // 4.2. Define Lexical (FTS) search query
    let lexicalQuery = supabase.rpc("match_knowledge_chunks_lexical", {
      query_text: queryText,
      match_count: rawLimit,
    });

    if (activeDocumentIdFilters !== null) {
      if (activeDocumentIdFilters.length === 1) {
        lexicalQuery = lexicalQuery.eq("document_id", activeDocumentIdFilters[0]);
      } else {
        lexicalQuery = lexicalQuery.in("document_id", activeDocumentIdFilters);
      }
    }

    // 4.3. Run both parallelly using Promise.allSettled
    console.log(`[SEARCH] Executando busca vetorial e busca lexical em paralelo...`);
    const [vectorRes, lexicalRes] = await Promise.allSettled([
      vectorQuery,
      lexicalQuery,
    ]);

    // 4.4. Handle Vector result or its fallback
    let rawVectorResults: any[] = [];
    if (vectorRes.status === "fulfilled" && !vectorRes.value.error) {
      rawVectorResults = vectorRes.value.data || [];
    } else {
      const rpcError = vectorRes.status === "fulfilled" ? vectorRes.value.error : vectorRes.reason;
      console.warn(`[SEARCH] RPC 'match_documents' falhou ou não existe. Tentando fallback para 'match_knowledge_chunks'...`);

      let fallbackVecQuery = supabase.rpc("match_knowledge_chunks", {
        query_embedding: finalEmbedding,
        match_count: rawLimit,
      });

      if (activeDocumentIdFilters !== null) {
        if (activeDocumentIdFilters.length === 1) {
          fallbackVecQuery = fallbackVecQuery.eq("document_id", activeDocumentIdFilters[0]);
        } else {
          fallbackVecQuery = fallbackVecQuery.in("document_id", activeDocumentIdFilters);
        }
      }

      try {
        const response = await fallbackVecQuery;
        if (response.error) {
          throw response.error;
        } else {
          rawVectorResults = response.data || [];
        }
      } catch (fallbackErr: any) {
        throw new Error(`Erro na busca vetorial por RPC (tanto match_documents quanto match_knowledge_chunks falharam): ${fallbackErr.message || fallbackErr}`);
      }
    }

    // 4.5. Handle Lexical result or its fallback
    let rawLexicalResults: any[] = [];
    let usedLexicalFallback = false;

    if (lexicalRes.status === "fulfilled" && !lexicalRes.value.error) {
      rawLexicalResults = lexicalRes.value.data || [];
    } else {
      const rpcError = lexicalRes.status === "fulfilled" ? lexicalRes.value.error : lexicalRes.reason;
      console.warn(`[SEARCH] RPC 'match_knowledge_chunks_lexical' falhou ou não existe (${rpcError?.message || rpcError}). Tentando fallback para .textSearch() na tabela...`);
      usedLexicalFallback = true;

      try {
        let fallbackQuery = supabase
          .from("knowledge_chunks")
          .select("id, document_id, chunk_index, content")
          .textSearch("content", queryText, { config: "portuguese", type: "websearch" })
          .limit(rawLimit);

        if (activeDocumentIdFilters !== null) {
          if (activeDocumentIdFilters.length === 1) {
            fallbackQuery = fallbackQuery.eq("document_id", activeDocumentIdFilters[0]);
          } else {
            fallbackQuery = fallbackQuery.in("document_id", activeDocumentIdFilters);
          }
        }

        const resp = await fallbackQuery;
        if (resp.error) {
          throw resp.error;
        } else {
          rawLexicalResults = (resp.data || []).map((item: any) => {
            const similarity = computeFallbackLexicalScore(item.content || "", queryText);
            return {
              id: item.id,
              document_id: item.document_id,
              chunk_index: item.chunk_index,
              content: item.content,
              similarity,
            };
          });
        }
      } catch (fallbackErr: any) {
        console.warn(`[SEARCH] Fallback lexical falhou: ${fallbackErr.message || fallbackErr}. Prosseguindo apenas com busca vetorial.`);
      }
    }

    // 5. Fusion of Results: deduplicate, combine scores, maintain diversity
    interface ChunkCandidate {
      id: string;
      documentId: string;
      chunkIndex: number;
      content: string;
      cleanText: string;
      metadata: any;
      filename: string;
      vectorScore: number;
      lexicalScore: number;
    }

    const candidateMap = new Map<string, ChunkCandidate>();

    // 5.1. Process Vector search contributors
    for (const item of rawVectorResults) {
      if (!item) continue;
      const vScore = item.similarity ?? 0;

      // Filter by vector score threshold (use strict scoreThreshold parameter)
      if (vScore < scoreThreshold) {
        continue;
      }

      const key = `${item.document_id}_${item.chunk_index}`;

      let cleanText = item.content ?? "";
      let metadata: any = {};
      const metaMatch = cleanText.match(/^\[METADATA:([\s\S]*?)\]\n([\s\S]*)$/);
      if (metaMatch) {
        try {
          metadata = JSON.parse(metaMatch[1]);
        } catch (e: any) {
          console.error(`[SEARCH] Erro ao fazer o parse do JSON de metadados do chunk: ${e.message}`);
        }
        cleanText = metaMatch[2] ?? "";
      }
      cleanText = cleanText.trim();

      const filename = documentNamesMap.get(item.document_id) || metadata.sourceDocument || "Desconhecido";

      candidateMap.set(key, {
        id: item.id,
        documentId: item.document_id,
        chunkIndex: item.chunk_index ?? 0,
        content: item.content ?? "",
        cleanText,
        metadata,
        filename,
        vectorScore: vScore,
        lexicalScore: 0,
      });
    }

    // 5.2. Process Lexical search contributors
    for (const item of rawLexicalResults) {
      if (!item) continue;
      const lScore = item.similarity ?? 0;

      // Filter by lexical score threshold
      if (lScore < HYBRID_MIN_LEXICAL_SCORE) {
        continue;
      }

      const key = `${item.document_id}_${item.chunk_index}`;
      const existing = candidateMap.get(key);

      if (existing) {
        existing.lexicalScore = Math.max(existing.lexicalScore, lScore);
      } else {
        let cleanText = item.content ?? "";
        let metadata: any = {};
        const metaMatch = cleanText.match(/^\[METADATA:([\s\S]*?)\]\n([\s\S]*)$/);
        if (metaMatch) {
          try {
            metadata = JSON.parse(metaMatch[1]);
          } catch (e: any) {
            console.error(`[SEARCH] Erro ao fazer o parse do JSON de metadados do chunk: ${e.message}`);
          }
          cleanText = metaMatch[2] ?? "";
        }
        cleanText = cleanText.trim();

        const filename = documentNamesMap.get(item.document_id) || metadata.sourceDocument || "Desconhecido";

        candidateMap.set(key, {
          id: item.id,
          documentId: item.document_id,
          chunkIndex: item.chunk_index ?? 0,
          content: item.content ?? "",
          cleanText,
          metadata,
          filename,
          vectorScore: 0,
          lexicalScore: lScore,
        });
      }
    }

    // 5.3. Text-based Deduplication preserving the maximum score
    const uniqueTextCandidates = new Map<string, ChunkCandidate>();

    for (const cand of candidateMap.values()) {
      const textKey = cand.cleanText.toLowerCase().trim();
      const candCombinedRawScore = (cand.vectorScore * HYBRID_VECTOR_WEIGHT) + (cand.lexicalScore * HYBRID_LEXICAL_WEIGHT);

      const existing = uniqueTextCandidates.get(textKey);
      if (existing) {
        const existingCombinedRawScore = (existing.vectorScore * HYBRID_VECTOR_WEIGHT) + (existing.lexicalScore * HYBRID_LEXICAL_WEIGHT);
        if (candCombinedRawScore > existingCombinedRawScore) {
          uniqueTextCandidates.set(textKey, cand);
        }
      } else {
        uniqueTextCandidates.set(textKey, cand);
      }
    }

    // 5.4. Calculate Composite Ranking Score and Apply Boosts
    const finalCandidates: SearchResultItem[] = [];

    for (const cand of uniqueTextCandidates.values()) {
      const combinedRawScore = (cand.vectorScore * HYBRID_VECTOR_WEIGHT) + (cand.lexicalScore * HYBRID_LEXICAL_WEIGHT);

      let finalScore = combinedRawScore;
      const reasons: string[] = [];

      reasons.push(`Base Vetorial: ${(cand.vectorScore * HYBRID_VECTOR_WEIGHT).toFixed(4)} (peso ${HYBRID_VECTOR_WEIGHT})`);
      reasons.push(`Base Lexical: ${(cand.lexicalScore * HYBRID_LEXICAL_WEIGHT).toFixed(4)} (peso ${HYBRID_LEXICAL_WEIGHT})`);

      // 5.4.1. Explicit Document Boost (+0.25)
      if (isDocumentExplicitlyMentioned(queryText, cand.filename)) {
        finalScore += EXPLICIT_DOC_BOOST;
        reasons.push(`Explicit mention of document: "${cand.filename}" (+${EXPLICIT_DOC_BOOST})`);
      }

      // 5.4.2. Metadata Quality Boost (+0.08)
      if (hasQualityMetadata(cand.cleanText, cand.metadata)) {
        finalScore += METADATA_QUALITY_BOOST;
        reasons.push(`High metadata quality (+${METADATA_QUALITY_BOOST})`);
      }

      finalCandidates.push({
        documentId: cand.documentId,
        chunkIndex: cand.chunkIndex,
        score: finalScore,
        text: cand.cleanText,
        metadata: {
          ...cand.metadata,
          sourceDocument: cand.filename,
          originalScore: combinedRawScore,
          vectorScore: cand.vectorScore,
          lexicalScore: cand.lexicalScore,
          reasons,
        },
      });
    }

    // 6. Greedy Document Diversity Re-ranking using DIVERSITY_PENALTY_FACTOR
    const dynamicResults: SearchResultItem[] = [];
    const docCounts = new Map<string, number>();

    // Sort by composite final score descending first
    finalCandidates.sort((a, b) => b.score - a.score);

    while (finalCandidates.length > 0) {
      finalCandidates.sort((a, b) => b.score - a.score);
      const chosen = finalCandidates.shift()!;
      dynamicResults.push(chosen);

      const docId = chosen.documentId;
      docCounts.set(docId, (docCounts.get(docId) ?? 0) + 1);

      // Penalize remaining candidates from the same document
      for (const item of finalCandidates) {
        if (item.documentId === docId) {
          item.score -= DIVERSITY_PENALTY_FACTOR;
          if (item.metadata) {
            item.metadata.reasons.push(`Diversity penalty applied (-${DIVERSITY_PENALTY_FACTOR})`);
          }
        }
      }
    }

    // Sort results by score descending again
    dynamicResults.sort((a, b) => b.score - a.score);

    // Limit output results strictly to topK
    const uniqueResults = dynamicResults.slice(0, topK);

    // 7. Structured Development Logs tracing search operations using down arrows (↓)
    if (env.NODE_ENV === "development" || !isTest) {
      console.log(`\nConsulta: "${queryText}"\n`);
      console.log(`↓\n`);

      console.log(`Resultados Vetoriais (${rawVectorResults.length}):`);
      rawVectorResults.forEach((res, i) => {
        console.log(`  - Resultado ${i+1}: chunk_id=${res.id || "N/A"}, document_id=${res.document_id}, similarity=${(res.similarity ?? 0).toFixed(4)}, scoreThreshold=${scoreThreshold}`);
      });
      console.log(`\n↓\n`);

      console.log(`Resultados Lexicais (${rawLexicalResults.length})${usedLexicalFallback ? " [Fallback JS]" : ""}:`);
      rawLexicalResults.forEach((res, i) => {
        console.log(`  - Resultado ${i+1}: chunk_id=${res.id || "N/A"}, document_id=${res.document_id}, similarity=${(res.similarity ?? 0).toFixed(4)}, scoreThreshold=${HYBRID_MIN_LEXICAL_SCORE}`);
      });
      console.log(`\n↓\n`);

      console.log(`Resultados Mesclados (Deduplicados e Fundidos):`);
      uniqueTextCandidates.forEach((cand, key) => {
        const combinedRaw = (cand.vectorScore * HYBRID_VECTOR_WEIGHT) + (cand.lexicalScore * HYBRID_LEXICAL_WEIGHT);
        console.log(`  - Chunk ${key}: vector=${cand.vectorScore.toFixed(4)}, lexical=${cand.lexicalScore.toFixed(4)}, combined=${combinedRaw.toFixed(4)}`);
      });
      console.log(`\n↓\n`);

      console.log(`Ranking Final (Com boosts de documento e metadados, e penalidade de diversidade):`);
      uniqueResults.forEach((res, i) => {
        const metadata = res.metadata || {};
        const reasonsStr = metadata.reasons && metadata.reasons.length > 0 ? metadata.reasons.join(", ") : "None";
        console.log(`  [Rank ${i+1}] Document: ${metadata.sourceDocument || "Desconhecido"} | Page: ${metadata.pageNumber ?? "N/A"}`);
        console.log(`    Original Score: ${(metadata.originalScore ?? res.score).toFixed(4)} -> Final Score: ${res.score.toFixed(4)}`);
        console.log(`    Boost Reasons / Score Motivations: ${reasonsStr}`);
        console.log(`    Snippet: "${res.text.substring(0, 80)}..."`);
      });
      console.log(`\n↓\n`);

      console.log(`Top K enviados ao Context Builder (${uniqueResults.length}):`);
      uniqueResults.forEach((res, i) => {
        console.log(`  - Rank ${i+1}: "${res.text.substring(0, 50)}..." [Score: ${res.score.toFixed(4)}]`);
      });
      console.log(`\n`);
    }

    // 8. Compute metrics and structured log
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
    logger.info("Busca híbrida (semântica + lexical) realizada com sucesso", {
      searchDurationMs: parseFloat(durationMs.toFixed(2)),
      resultsCount: count,
      averageScore: parseFloat(averageScore.toFixed(4)),
      consultedDocuments,
    });
  }
}
