import { env } from "../config/env.js";
import { SearchService } from "./search.service.js";
import { ContextBuilderService } from "./context-builder.service.js";
import { PromptBuilderService } from "./prompt-builder.service.js";
import { chatWithContextConfigurable } from "../groq/chat.js";
import { supabase } from "../config/supabase.js";
import { logger } from "./logger.service.js";
import { metricsService } from "./metrics.service.js";

export interface ChatOptions {
  temperature?: number;
  topK?: number;
  maxContextSize?: number;
  timeout?: number;
  model?: string;
  scoreThreshold?: number;
  minChunksPerDocument?: number;
  filters?: {
    documentId?: string;
    category?: string;
    documentType?: string;
  };
}

export interface ChatSource {
  documentId: string;
  filename: string;
  chunkIndex: number;
  score: number;
}

export interface ChatResponse {
  answer: string;
  sources: ChatSource[];
  metadata: {
    searchTime: string;
    generationTime: string;
    totalTime: string;
  };
}

const FORBIDDEN_GENERIC_WORDS = new Set([
  "militar",
  "policia",
  "policial",
  "codigo",
  "regulamento",
  "processo",
  "artigo",
  "disciplinar",
  "administrativo",
  "instrucao",
  "pm",
  "pdf",
  "manual",
  "comentado",
  "documento",
  "instrucoes",
  "regulamentos",
  "codigos",
  "processos",
  "artigos",
  "militarizado",
  "policiais",
  "lei",
  "leis",
  "decreto",
  "decretos",
  "resolucao",
  "resolucoes",
  "portaria",
  "portarias",
  "de",
  "do",
  "da",
  "o",
  "a",
  "os",
  "as",
  "um",
  "uma",
  "em",
  "no",
  "na",
  "nos",
  "nas",
  "para",
  "com",
  "por"
]);

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove accents
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"']/g, " ") // replace punctuation, hyphens, underscores with space
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegex(text: string): string {
  return text.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
}

function getFilenameAliases(fileName: string): string[] {
  const cleanName = fileName.toLowerCase().replace(/\.[^/.]+$/, ""); // remove extension
  const normName = normalizeText(cleanName);

  const aliases = new Set<string>();

  // Add normalized full clean name (with and without spaces)
  aliases.add(normName);
  aliases.add(normName.replace(/\s+/g, ""));

  // Split parts
  const parts = normName.split(/\s+/);

  // If we have parts like "i" and "18" (originally "I-18"), let's preserve combinations
  // Look for any pattern in filename that matches letters + numbers, like i-18, i-2, pop-101
  const rawClean = cleanName.toLowerCase();
  const specMatches = rawClean.match(/[a-z]+-?\d+/g);
  if (specMatches) {
    for (const match of specMatches) {
      const normMatch = normalizeText(match);
      aliases.add(normMatch);
      aliases.add(normMatch.replace(/\s+/g, ""));
    }
  }

  // Build acronym for parts
  if (parts.length > 1) {
    const acronym = parts.map(p => p[0]).join("");
    if (acronym.length >= 2) {
      aliases.add(acronym);
    }
  }

  // Explicit mappings for well-known acronyms
  if (normName.includes("codigo penal militar")) {
    aliases.add("cpm");
    aliases.add("codigo penal militar");
  }
  if (normName.includes("regulamento disciplinar")) {
    aliases.add("rdpm");
    aliases.add("regulamento disciplinar");
  }

  // Also add any word in the filename that is NOT generic and is at least 3 chars
  for (const part of parts) {
    if (part.length >= 3 && !FORBIDDEN_GENERIC_WORDS.has(part)) {
      aliases.add(part);
    }
  }

  return Array.from(aliases).filter(a => a.trim().length >= 2);
}

/**
 * Checks whether a question is asking for a literal transcription of an article/text,
 * as opposed to an explanation, interpretation, summary, or comparison.
 */
export function isLiteralArticleRequest(question: string): boolean {
  if (!question || typeof question !== "string") return false;
  const norm = normalizeText(question);

  // Explanation, interpretation, summary, or comparison queries MUST go to LLM
  const isExplanationOrSummary = /\b(explique|explicar|explicacao|explicação|interprete|interpretar|interpretacao|interpretação|resuma|resumo|resumir|compare|comparar|comparacao|comparação|por que|porque|como funciona|qual a diferenca|qual a diferença)\b/i.test(norm);
  if (isExplanationOrSummary) {
    return false;
  }

  // Literal transcription trigger terms
  const literalTriggers = [
    "conteudo",
    "conteudo do artigo",
    "texto",
    "texto do artigo",
    "redacao",
    "redacao do artigo",
    "o que diz",
    "o que dizem",
    "transcreva",
    "transcrever",
    "transcricao",
    "transcrição",
    "integra",
    "integra do artigo",
    "copie",
    "qual o texto",
    "qual e o texto",
    "qual a redacao",
    "qual a redação",
    "qual o conteudo",
    "qual e o conteudo"
  ];

  for (const trigger of literalTriggers) {
    const escaped = escapeRegex(trigger);
    const regex = new RegExp(`\\b${escaped}\\b`, "i");
    if (regex.test(norm)) {
      return true;
    }
  }

  return false;
}

/**
 * Extracts requested article identifier/number from the user's question (e.g. "23", "23-A", "5").
 */
export function extractRequestedArticleNumber(question: string): string | null {
  if (!question || typeof question !== "string") return null;
  const match = question.match(/\b(?:Artigo|Art\.)\s*(\d+(?:-[A-Za-z\d]+)?\b[ºª]?|\d+)/i);
  if (!match) return null;
  // Clean ordinal suffix º or ª from number
  return match[1].replace(/[ºª]/g, "").trim();
}

/**
 * Extracts strictly the text of a target article from a larger text block containing multiple articles,
 * starting at the target article header ("Art. 23", "Artigo 23") and stopping right before the next article header.
 */
export function extractArticleFromText(fullText: string, articleNum: string): string | null {
  if (!fullText || !articleNum) return null;

  // Header regex for target article (e.g., Art. 23, Artigo 23, Artigo 23º, Art. 23-A)
  const escapedNum = escapeRegex(articleNum);
  const startRegex = new RegExp(`\\b(?:Artigo|Art\\.)\\s*${escapedNum}\\b[ºª]?`, "i");
  const startMatch = startRegex.exec(fullText);

  if (!startMatch) return null;

  const startIndex = startMatch.index;
  const afterStartText = fullText.substring(startIndex + startMatch[0].length);

  // Search for the next article header after the target article header
  const nextArticleRegex = /\b(?:Artigo|Art\.)\s*\d+(?:-[A-Za-z\d]+)?\b[ºª]?/gi;
  const nextMatch = nextArticleRegex.exec(afterStartText);

  let extracted: string;
  if (nextMatch) {
    const endIndex = startIndex + startMatch[0].length + nextMatch.index;
    extracted = fullText.substring(startIndex, endIndex).trim();
  } else {
    extracted = fullText.substring(startIndex).trim();
  }

  return extracted || null;
}

/**
 * Determines whether retrieved text represents a partial article excerpt.
 */
export function isPartialArticleChunk(text: string): boolean {
  if (!text || text.trim() === "") return true;
  const trimmed = text.trim();

  // Check if text starts with "Artigo" or "Art." or "Art"
  const startsWithArticleHeader = /^\b(?:Artigo|Art\.)\s*\d+/i.test(trimmed);
  if (!startsWithArticleHeader) {
    return true; // Missing article header -> partial excerpt
  }

  // Check if text ends abruptly without terminal punctuation
  const endsWithTerminalPunctuation = /[.!?;\:]$/.test(trimmed);
  if (!endsWithTerminalPunctuation) {
    return true; // Incomplete sentence/paragraph -> partial excerpt
  }

  return false;
}

export class ChatService {
  /**
   * Resolves document scope based on keywords inside the question or filters.
   * Scans and returns all matching documents found in the question.
   *
   * @param question - The user's question.
   * @param filters - Optional pre-existing filters.
   * @returns List of resolved documents.
   */
  static async resolveDocuments(
    question: string,
    filters?: { documentId?: string; [key: string]: any }
  ): Promise<{ documentId: string; filename: string }[]> {
    const resolvedDocs: { documentId: string; filename: string }[] = [];
    const seenIds = new Set<string>();

    // 1. If a documentId is already present in filters, try to fetch its details to confirm/resolve
    if (filters?.documentId) {
      try {
        const { data: doc, error } = await supabase
          .from("knowledge_documents")
          .select("id, file_name")
          .eq("id", filters.documentId)
          .maybeSingle();

        if (!error && doc) {
          resolvedDocs.push({ documentId: doc.id, filename: doc.file_name ?? "Desconhecido" });
          seenIds.add(doc.id);
        }
      } catch (err) {
        logger.error("Erro ao validar documentId existente em resolveDocuments", err);
      }
    }

    const normQuestion = normalizeText(question);

    // 2. Fetch all documents to perform matching
    try {
      const { data: docs, error } = await supabase
        .from("knowledge_documents")
        .select("id, file_name");

      if (!error && docs) {
        for (const doc of docs) {
          if (seenIds.has(doc.id)) continue;

          const fileName = doc.file_name ?? "";
          if (!fileName) continue;

          const aliases = getFilenameAliases(fileName);
          let isMatch = false;

          for (const alias of aliases) {
            const escaped = escapeRegex(alias);
            const regex = new RegExp(`\\b${escaped}\\b`, "i");
            if (regex.test(normQuestion)) {
              isMatch = true;
              break;
            }
          }

          if (isMatch) {
            resolvedDocs.push({ documentId: doc.id, filename: fileName });
            seenIds.add(doc.id);
          }
        }
      }
    } catch (err) {
      logger.error("Erro na busca de documentos para resolução de múltiplos documentos", err);
    }

    return resolvedDocs;
  }

  /**
   * Orchestrates the complete RAG flow:
   * Pergunta -> Geração de embedding -> Busca semântica -> Recuperar contexto -> Montar prompt -> Groq -> Resposta estruturada
   *
   * @param question - User question
   * @param options - Custom configuration overrides
   */
  static async chat(question: string, options: ChatOptions = {}): Promise<ChatResponse> {
    const overallStartTime = performance.now();

    // Increment chat metric
    metricsService.incrementChats();

    // 1. Input Validation
    if (!question || typeof question !== "string" || question.trim() === "") {
      const err = new Error("A pergunta não pode ser vazia.");
      (err as any).status = 400;
      throw err;
    }

    // Resolve parameter configuration with fallbacks
    const topK = options.topK !== undefined ? options.topK : (env.DEFAULT_TOP_K ?? 5);
    const scoreThreshold = options.scoreThreshold !== undefined ? options.scoreThreshold : (env.DEFAULT_MIN_SCORE ?? 0.15);
    const maxContextSize = options.maxContextSize !== undefined ? options.maxContextSize : (env.DEFAULT_MAX_CONTEXT_SIZE ?? 4000);
    const temperature = options.temperature !== undefined ? options.temperature : 0;
    const timeout = options.timeout !== undefined ? options.timeout : 25000;
    let model = options.model !== undefined ? options.model : env.DEFAULT_CHAT_MODEL;

    const allowedModels = [env.DEFAULT_CHAT_MODEL, "llama3-8b-8192", "llama3-70b-8192", "mixtral-8x7b-32768", "gemma2-9b-it"];
    if (!allowedModels.includes(model)) {
      model = env.DEFAULT_CHAT_MODEL;
    }

    // A. Resolve document scope from the question or filters
    const resolvedDocs = await ChatService.resolveDocuments(question, options.filters);
    const activeFilters: any = { ...options.filters };

    if (resolvedDocs.length === 1) {
      activeFilters.documentId = resolvedDocs[0].documentId;
    } else if (resolvedDocs.length > 1) {
      activeFilters.documentIds = resolvedDocs.map(d => d.documentId);
      delete activeFilters.documentId;
    }

    const resolvedDocNames = resolvedDocs.length > 0
      ? (resolvedDocs.length === 1 ? resolvedDocs[0].filename : resolvedDocs.map(d => d.filename).join(", "))
      : null;
    const resolvedDocIds = resolvedDocs.length > 0
      ? (resolvedDocs.length === 1 ? resolvedDocs[0].documentId : resolvedDocs.map(d => d.documentId).join(", "))
      : null;

    // Log the resolved document details as requested
    logger.info("Documento resolvido para busca", {
      "documento resolvido": resolvedDocNames,
      "document_id": resolvedDocIds
    });

    const isDocExplicitlyRequested = !!(options.filters?.documentId || resolvedDocs.length > 0);
    const isRestrictedSearch = !!(activeFilters.documentId || activeFilters.documentIds);

    // 2. Perform Semantic Search
    let searchResults = [];
    let initialResultsCount = 0;
    let fallbackExecuted = false;
    let globalResultsCount: number | undefined = undefined;

    const searchStartTime = performance.now();
    try {
      if (resolvedDocs.length > 1) {
        const minChunks = options.minChunksPerDocument !== undefined
          ? options.minChunksPerDocument
          : env.DEFAULT_MIN_CHUNKS_PER_DOCUMENT;

        const searchPromises = resolvedDocs.map(async (doc) => {
          const docFilters = { ...options.filters, documentId: doc.documentId };
          if ((docFilters as any).documentIds) {
            delete (docFilters as any).documentIds;
          }
          return SearchService.search(
            question,
            minChunks,
            scoreThreshold,
            docFilters
          );
        });

        const individualResults = await Promise.all(searchPromises);

        // Combine all results
        const combinedResults = individualResults.flat();

        // Sort by similarity score descending first, so higher score versions of duplicates are preserved
        combinedResults.sort((a, b) => b.score - a.score);

        // Remove duplicates by text content
        const seenTexts = new Set<string>();
        const uniqueCombinedResults = [];
        for (const r of combinedResults) {
          const norm = (r?.text ?? "").trim().toLowerCase();
          if (!seenTexts.has(norm)) {
            seenTexts.add(norm);
            uniqueCombinedResults.push(r);
          }
        }
        searchResults = uniqueCombinedResults;
      } else {
        searchResults = await SearchService.search(
          question,
          topK,
          scoreThreshold,
          activeFilters
        );
      }

      initialResultsCount = searchResults.length;

      // 4. Fallback obrigatório: Caso exista filtro de documento e a busca retorne zero resultados, tenta busca global
      if (initialResultsCount === 0 && isRestrictedSearch) {
        fallbackExecuted = true;
        const globalFilters = { ...activeFilters };
        delete globalFilters.documentId;
        delete globalFilters.documentIds;

        searchResults = await SearchService.search(
          question,
          topK,
          scoreThreshold,
          globalFilters
        );
        globalResultsCount = searchResults.length;
      }
    } catch (error: any) {
      logger.error("Erro na busca vetorial do banco vetorial", error);
      const err = new Error(`Erro na busca vetorial da base de dados: ${error.message}`);
      (err as any).status = 500;
      throw err;
    }
    const searchTimeMs = performance.now() - searchStartTime;

    const resultsCount = searchResults.length;

    // Print development logs when NODE_ENV === "development"
    if (env.NODE_ENV === "development") {
      logger.info(`[RESOLUTION AUDIT]
Documento explicitamente solicitado:
${isDocExplicitlyRequested ? "SIM" : "NÃO"}

↓

Documento resolvido
${resolvedDocNames || "Nenhum"}

↓

Busca restrita
${isRestrictedSearch ? "SIM" : "NÃO"}

↓

Resultados
${initialResultsCount}

↓

Fallback executado?
${fallbackExecuted ? "SIM" : "NÃO"}

↓

Resultados da busca global
${globalResultsCount !== undefined ? globalResultsCount : "N/A"}`);
    }

    // Log resultsCount as requested
    logger.info("Contagem de resultados da busca semântica", {
      resultsCount
    });

    // 3. Handle Empty/Insufficient Context Scenario (First Check: resultsCount === 0)
    if (resultsCount === 0) {
      const overallDuration = performance.now() - overallStartTime;
      const motivoInsuficiencia = `Nenhum trecho relevante foi retornado da busca no banco de dados. Pergunta: "${question}". Documento resolvido: ${resolvedDocNames || "Nenhum"}. Filtros ativos: ${JSON.stringify(activeFilters)}. Limite mínimo de similaridade exigido: ${scoreThreshold}.`;

      // Log motivo exato da insuficiência quando ocorrer
      logger.info("Insuficiência de contexto detectada", {
        "documento resolvido": resolvedDocNames,
        "document_id": resolvedDocIds,
        resultsCount,
        "motivo exato da insuficiência": motivoInsuficiencia
      });

      logger.info("Fluxo de Chat concluído com contexto vazio", {
        searchTimeMs: parseFloat(searchTimeMs.toFixed(2)),
        generationTimeMs: 0,
        totalTimeMs: parseFloat(overallDuration.toFixed(2)),
        documentsCount: 0,
        chunksCount: 0,
      });

      return {
        answer: `Não encontrei essa informação na base de conhecimento. Causa detalhada: ${motivoInsuficiencia}`,
        sources: [],
        metadata: {
          searchTime: `${searchTimeMs.toFixed(0)}ms`,
          generationTime: "0ms",
          totalTime: `${overallDuration.toFixed(0)}ms`,
        },
      };
    }

    // 4. Retrieve Filenames for the retrieved Document IDs
    const docIds = Array.from(new Set(searchResults.map((r) => r.documentId)));
    const docMap = new Map<string, string>();
    if (docIds.length > 0) {
      try {
        const { data: matchedDocs, error: docError } = await supabase
          .from("knowledge_documents")
          .select("id, file_name")
          .in("id", docIds);

        if (docError) {
          throw docError;
        }

        if (matchedDocs) {
          for (const d of matchedDocs) {
            docMap.set(d.id, d.file_name);
          }
        }
      } catch (error: any) {
        logger.error("Erro ao carregar nomes de arquivos no ChatService", error);
        // Fallback gracefully without breaking the entire flow
      }
    }

    // 5. Prepare and enrich chunk metadata before passing to ContextBuilder
    const chunksToProcess = searchResults.map(r => ({
      ...r,
      documentName: docMap.get(r.documentId) || r.metadata?.sourceDocument || "Desconhecido",
    }));

    // 6. Build Context and Prompts via detailed builder to track exactly used chunks
    const { context, selectedChunks: finalUsedChunks } = ContextBuilderService.buildContextDetailed(chunksToProcess, maxContextSize);

    // Second Check: No valid chunk retrieved/utilized
    if (finalUsedChunks.length === 0) {
      const overallDuration = performance.now() - overallStartTime;
      const motivoInsuficiencia = `Nenhum chunk válido permaneceu após a filtragem de sobreposição ou excesso de contexto. Resultados da busca inicial: ${resultsCount} chunks. Pergunta: "${question}". Documento resolvido: ${resolvedDocNames || "Nenhum"}. Limite de contexto: ${maxContextSize} caracteres.`;

      // Log motivo exato da insuficiência quando ocorrer
      logger.info("Insuficiência de contexto detectada", {
        "documento resolvido": resolvedDocNames,
        "document_id": resolvedDocIds,
        resultsCount,
        "motivo exato da insuficiência": motivoInsuficiencia
      });

      logger.info("Fluxo de Chat concluído com contexto vazio", {
        searchTimeMs: parseFloat(searchTimeMs.toFixed(2)),
        generationTimeMs: 0,
        totalTimeMs: parseFloat(overallDuration.toFixed(2)),
        documentsCount: 0,
        chunksCount: 0,
      });

      return {
        answer: `Não encontrei essa informação na base de conhecimento. Causa detalhada: ${motivoInsuficiencia}`,
        sources: [],
        metadata: {
          searchTime: `${searchTimeMs.toFixed(0)}ms`,
          generationTime: "0ms",
          totalTime: `${overallDuration.toFixed(0)}ms`,
        },
      };
    }

    // Direct Article Transcription Bypass (No LLM generation for literal requests)
    if (isLiteralArticleRequest(question)) {
      const generationStartTime = performance.now();

      const docGroupedTexts: Record<string, string[]> = {};
      for (const chunk of finalUsedChunks) {
        const docName = docMap.get(chunk.documentId) || chunk.documentName || "Desconhecido";
        if (!docGroupedTexts[docName]) {
          docGroupedTexts[docName] = [];
        }
        docGroupedTexts[docName].push(chunk.text);
      }

      const responseParts: string[] = [];
      const isMultiDoc = Object.keys(docGroupedTexts).length > 1;

      const targetArticleNum = extractRequestedArticleNumber(question);

      for (const [docName, texts] of Object.entries(docGroupedTexts)) {
        const fullDocText = texts.join("\n\n").trim();
        let exactText = fullDocText;

        if (targetArticleNum) {
          const extractedArticle = extractArticleFromText(fullDocText, targetArticleNum);
          if (extractedArticle) {
            exactText = extractedArticle;
          }
        }

        const header = isMultiDoc ? `**${docName}**\n` : "";
        const isPartial = isPartialArticleChunk(exactText);

        if (isPartial) {
          responseParts.push(`${header}Transcrição parcial (trecho disponível na base de conhecimento):\n\n${exactText}`);
        } else {
          responseParts.push(`${header}${exactText}`);
        }
      }

      const directAnswer = responseParts.join("\n\n---\n\n");
      const generationTimeMs = performance.now() - generationStartTime;
      const overallDuration = performance.now() - overallStartTime;

      const sources: ChatSource[] = finalUsedChunks.map((c) => ({
        documentId: c.documentId,
        filename: docMap.get(c.documentId) || c.documentName || "Desconhecido",
        chunkIndex: c.chunkIndex,
        score: c.score !== undefined ? parseFloat(c.score.toFixed(4)) : 0,
      }));

      logger.info("Fluxo de Chat RAG concluído via transcrição direta (sem LLM)", {
        searchTimeMs: parseFloat(searchTimeMs.toFixed(2)),
        generationTimeMs: parseFloat(generationTimeMs.toFixed(2)),
        totalTimeMs: parseFloat(overallDuration.toFixed(2)),
        documentsCount: new Set(sources.map((s) => s.documentId)).size,
        chunksCount: sources.length,
      });

      return {
        answer: directAnswer,
        sources,
        metadata: {
          searchTime: `${searchTimeMs.toFixed(0)}ms`,
          generationTime: `${generationTimeMs.toFixed(0)}ms`,
          totalTime: `${overallDuration.toFixed(0)}ms`,
        },
      };
    }

    const systemPrompt = PromptBuilderService.buildSystemPrompt();
    const userPrompt = PromptBuilderService.buildUserPrompt(question, context);

    // 7. Invoke LLM Groq API
    const generationStartTime = performance.now();
    let answer = "";
    try {
      answer = await chatWithContextConfigurable(question, context, {
        model,
        temperature,
        timeout,
        systemPrompt,
        userPrompt,
      });
    } catch (error: any) {
      logger.error("Falha ao invocar LLM no ChatService", error, {
        question,
        contextSize: context ? context.length : 0,
        model,
        temperature,
        timeout,
      });
      const isTimeout = error.message && (
        error.message.includes("tempo limite") ||
        error.message.toLowerCase().includes("timeout") ||
        error.message.toLowerCase().includes("timed out")
      );
      const err = new Error(
        isTimeout
          ? `O tempo limite de processamento de ${timeout}ms foi excedido.`
          : `Falha ao gerar resposta do Groq: ${error.message}`
      );
      (err as any).status = isTimeout ? 504 : 502;
      (err as any).originalError = error;
      throw err;
    }
    const generationTimeMs = performance.now() - generationStartTime;

    const overallDuration = performance.now() - overallStartTime;

    // 8. Build Structured Sources List
    const sources: ChatSource[] = finalUsedChunks.map((c) => ({
      documentId: c.documentId,
      filename: docMap.get(c.documentId) || c.documentName || "Desconhecido",
      chunkIndex: c.chunkIndex,
      score: c.score !== undefined ? parseFloat(c.score.toFixed(4)) : 0,
    }));

    // 9. Structured Logging of metrics
    const uniqueDocsCount = new Set(sources.map((s) => s.documentId)).size;
    logger.info("Fluxo de Chat RAG concluído com sucesso", {
      searchTimeMs: parseFloat(searchTimeMs.toFixed(2)),
      generationTimeMs: parseFloat(generationTimeMs.toFixed(2)),
      totalTimeMs: parseFloat(overallDuration.toFixed(2)),
      documentsCount: uniqueDocsCount,
      chunksCount: sources.length,
    });

    return {
      answer,
      sources,
      metadata: {
        searchTime: `${searchTimeMs.toFixed(0)}ms`,
        generationTime: `${generationTimeMs.toFixed(0)}ms`,
        totalTime: `${overallDuration.toFixed(0)}ms`,
      },
    };
  }
}
