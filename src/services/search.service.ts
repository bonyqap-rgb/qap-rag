import { supabase } from "../config/supabase.js";
import { env } from "../config/env.js";
import { createEmbedding } from "../groq/embed.js";
import { logger } from "./logger.service.js";
import { metricsService } from "./metrics.service.js";

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
    [key: string]: any;
  };
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

    // 4. Query pgvector via match_documents RPC (with fallback to match_knowledge_chunks)
    // Increase raw candidate limit to Math.max(topK * 6, 60) for a rich, diverse candidate pool.
    const rawLimit = Math.max(topK * 6, 60);

    console.log(`[SEARCH] Consulta RPC utilizada: rpc("match_documents", { query_embedding: [array de dimensão ${finalEmbedding.length}], match_count: ${rawLimit} })`);
    console.log(`[SEARCH] Filtros ativos: Não existem filtros por tenant, organização, usuário ou status que eliminem registros na tabela ou na RPC.`);

    let dbQuery = supabase.rpc("match_documents", {
      query_embedding: finalEmbedding,
      match_count: rawLimit,
    });

    if (activeDocumentIdFilters !== null) {
      console.log(`[SEARCH] Aplicando filtro PostgREST de document_id: ${JSON.stringify(activeDocumentIdFilters)}`);
      if (activeDocumentIdFilters.length === 1) {
        dbQuery = dbQuery.eq("document_id", activeDocumentIdFilters[0]);
      } else {
        dbQuery = dbQuery.in("document_id", activeDocumentIdFilters);
      }
    }

    let rawResults: any[] | null = null;
    let rpcError: any = null;

    try {
      const response = await dbQuery;
      if (response.error) {
        rpcError = response.error;
      } else {
        rawResults = response.data;
      }
    } catch (err: any) {
      rpcError = err;
    }

    // Fallback if match_documents failed
    if (rpcError) {
      console.warn(`[SEARCH] RPC 'match_documents' falhou ou não existe (${rpcError.message || rpcError}). Tentando fallback para 'match_knowledge_chunks'...`);
      let fallbackQuery = supabase.rpc("match_knowledge_chunks", {
        query_embedding: finalEmbedding,
        match_count: rawLimit,
      });

      if (activeDocumentIdFilters !== null) {
        if (activeDocumentIdFilters.length === 1) {
          fallbackQuery = fallbackQuery.eq("document_id", activeDocumentIdFilters[0]);
        } else {
          fallbackQuery = fallbackQuery.in("document_id", activeDocumentIdFilters);
        }
      }

      try {
        const response = await fallbackQuery;
        if (response.error) {
          throw response.error;
        } else {
          rawResults = response.data;
          rpcError = null; // Cleared since fallback succeeded
        }
      } catch (fallbackErr: any) {
        throw new Error(`Erro na busca vetorial por RPC (tanto match_documents quanto match_knowledge_chunks falharam): ${fallbackErr.message || fallbackErr}`);
      }
    }

    const results = (rawResults as any[]) || [];
    console.log(`[SEARCH] Resultados brutos retornados pela RPC (${results.length}):`);

    // 5. Post-process: extract clean text, parse metadata, apply similarity threshold, then apply boosts & diversity penalty
    const candidateResults: SearchResultItem[] = [];
    const seenTexts = new Set<string>();

    for (let idx = 0; idx < results.length; idx++) {
      const item = results[idx];
      if (!item) continue;
      const originalScore = item.similarity ?? 0;

      // Extract clean text and parse embedded metadata block
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

      console.log(`  - Resultado ${idx + 1}: chunk_id=${item.id}, document_id=${item.document_id}, similarity=${originalScore}, scoreThreshold=${scoreThreshold}`);

      // ENFORCE SCORE THRESHOLD on the original similarity score to filter out irrelevant candidates before boosting
      if (originalScore < scoreThreshold) {
        console.log(`    [THRESHOLD FILTER] Descartado: score original ${originalScore} é menor que o threshold mínimo ${scoreThreshold} para texto: "${cleanText.substring(0, 30)}..."`);
        continue;
      }

      const textKey = (cleanText ?? "").toLowerCase();

      // Deduplicate
      if (!seenTexts.has(textKey)) {
        seenTexts.add(textKey);

        // Apply Boosting
        let finalScore = originalScore;
        const reasons: string[] = [];

        // 5.1. Explicit Document Boost (+0.25)
        if (isDocumentExplicitlyMentioned(queryText, filename)) {
          finalScore += EXPLICIT_DOC_BOOST;
          reasons.push(`Explicit mention of document: "${filename}" (+${EXPLICIT_DOC_BOOST})`);
        }

        // 5.2. Metadata Quality Boost (+0.08)
        if (hasQualityMetadata(cleanText, metadata)) {
          finalScore += METADATA_QUALITY_BOOST;
          reasons.push(`High metadata quality (+${METADATA_QUALITY_BOOST})`);
        }

        candidateResults.push({
          documentId: item.document_id,
          chunkIndex: item.chunk_index ?? 0,
          score: finalScore,
          text: cleanText,
          metadata: {
            ...metadata,
            sourceDocument: filename,
            originalScore,
            reasons,
          },
        });
      } else {
        console.log(`    [DEDUPLICATE FILTER] Descartado por texto duplicado: "${cleanText.substring(0, 30)}..."`);
      }
    }

    // 6. Apply Greedy Document Diversity Re-ranking using DIVERSITY_PENALTY_FACTOR
    // Penalize subsequent chunks from the same document (each subsequent chunk receives a penalty of DIVERSITY_PENALTY_FACTOR * documentCount).
    const dynamicResults: SearchResultItem[] = [];
    const docCounts = new Map<string, number>();

    // Sort by final score descending first
    candidateResults.sort((a, b) => b.score - a.score);

    while (candidateResults.length > 0) {
      // Re-sort candidateResults on each iteration because penalty applications may dynamically shift ranks
      candidateResults.sort((a, b) => b.score - a.score);
      const chosen = candidateResults.shift()!;
      dynamicResults.push(chosen);

      const docId = chosen.documentId;
      docCounts.set(docId, (docCounts.get(docId) ?? 0) + 1);

      // Penalize remaining candidates from the same document
      for (const item of candidateResults) {
        if (item.documentId === docId) {
          item.score -= DIVERSITY_PENALTY_FACTOR;
          if (item.metadata) {
            item.metadata.reasons.push(`Diversity penalty applied (-${DIVERSITY_PENALTY_FACTOR})`);
          }
        }
      }
    }

    // Enforce final order sorted by score descending
    dynamicResults.sort((a, b) => b.score - a.score);

    // Limit output results strictly to topK
    const uniqueResults = dynamicResults.slice(0, topK);

    // Development-only logging of detailed scoring and boost reasoning
    if (env.NODE_ENV === "development" || !isTest) {
      console.log(`[RETRIEVAL AUDIT] Query: "${queryText}"`);
      uniqueResults.forEach((res, i) => {
        const metadata = res.metadata || {};
        const page = metadata.pageNumber ?? "N/A";
        const orig = metadata.originalScore ?? res.score;
        const final = res.score;
        const reasonsStr = metadata.reasons && metadata.reasons.length > 0 ? metadata.reasons.join(", ") : "None";
        console.log(`  [Rank ${i+1}] Document: ${metadata.sourceDocument || "Desconhecido"} | Page: ${page}`);
        console.log(`    Original Score: ${orig.toFixed(4)} -> Final Score: ${final.toFixed(4)}`);
        console.log(`    Boost Reasons: ${reasonsStr}`);
        console.log(`    Snippet: "${res.text.substring(0, 80)}..."`);
      });
    }

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
