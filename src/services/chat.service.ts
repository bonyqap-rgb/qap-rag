import { env } from "../config/env.js";
import { SearchService } from "./search.service.js";
import { ContextBuilderService } from "./context-builder.service.js";
import { PromptBuilderService } from "./prompt-builder.service.js";
import { chatWithContextConfigurable } from "../groq/chat.js";
import { supabase } from "../config/supabase.js";
import { logger } from "./logger.service.js";
import { metricsService } from "./metrics.service.js";
import { createEmbedding } from "../groq/embed.js";

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

    const lowerQuestion = question.toLowerCase();

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

          const cleanName = fileName.toLowerCase().replace(/\.[^/.]+$/, "");
          let isMatch = false;

          if (cleanName && lowerQuestion.includes(cleanName)) {
            isMatch = true;
          } else {
            // Also check for components of the filename
            const parts = cleanName.split(/[_\s]+/);
            for (const part of parts) {
              if (part.length >= 3 && lowerQuestion.includes(part)) {
                isMatch = true;
                break;
              }
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
    const scoreThreshold = options.scoreThreshold !== undefined ? options.scoreThreshold : (env.DEFAULT_MIN_SCORE ?? 0.3);
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

    // 2. Perform Semantic Search
    let searchResults = [];
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
    } catch (error: any) {
      logger.error("Erro na busca vetorial do banco vetorial", error);
      const err = new Error(`Erro na busca vetorial da base de dados: ${error.message}`);
      (err as any).status = 500;
      throw err;
    }
    const searchTimeMs = performance.now() - searchStartTime;

    const resultsCount = searchResults.length;

    // Log resultsCount as requested
    logger.info("Contagem de resultados da busca semântica", {
      resultsCount
    });

    // 3. Handle Empty/Insufficient Context Scenario (First Check: resultsCount === 0)
    if (resultsCount === 0) {
      const overallDuration = performance.now() - overallStartTime;
      const motivoInsuficiencia = "Nenhum trecho retornado da busca semântica (resultsCount === 0)";

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

      ChatService.logRagPipelineFlow(
        question,
        0,
        0,
        [],
        [],
        [],
        0,
        "Não encontrei essa informação na base de conhecimento."
      );

      return {
        answer: "Não encontrei essa informação na base de conhecimento.",
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
      const motivoInsuficiencia = "Nenhum chunk válido foi recuperado após filtragem/processamento de contexto (finalUsedChunks.length === 0)";

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

      ChatService.logRagPipelineFlow(
        question,
        resultsCount,
        searchResults.length > 0 ? Math.max(...searchResults.map(r => r.score)) : 0,
        [],
        [],
        [],
        0,
        "Não encontrei essa informação na base de conhecimento."
      );

      return {
        answer: "Não encontrei essa informação na base de conhecimento.",
        sources: [],
        metadata: {
          searchTime: `${searchTimeMs.toFixed(0)}ms`,
          generationTime: "0ms",
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

    const topScore = searchResults.length > 0 ? Math.max(...searchResults.map(r => r.score)) : 0;
    const finalDocNames = Array.from(new Set(finalUsedChunks.map(c => c.documentName).filter(Boolean))) as string[];
    const finalPages = Array.from(new Set(finalUsedChunks.map(c => (c as any).page).filter(p => p !== undefined && p !== null))) as (string | number)[];
    const finalArticles = Array.from(new Set(finalUsedChunks.map(c => c.article).filter(Boolean))) as string[];

    ChatService.logRagPipelineFlow(
      question,
      resultsCount,
      topScore,
      finalDocNames,
      finalPages,
      finalArticles,
      context.length,
      answer
    );

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

  /**
   * Executes a complete RAG pipeline diagnosis.
   * Returns intermediate steps and embeddings for auditing purposes.
   */
  static async diagnose(question: string, options: ChatOptions = {}): Promise<any> {
    const overallStartTime = performance.now();

    // 1. Generate embedding first to return it in diagnosis
    const embedding = await createEmbedding(question);

    // Resolve parameter configuration with fallbacks
    const topK = options.topK !== undefined ? options.topK : (env.DEFAULT_TOP_K ?? 5);
    const scoreThreshold = options.scoreThreshold !== undefined ? options.scoreThreshold : (env.DEFAULT_MIN_SCORE ?? 0.3);
    const maxContextSize = options.maxContextSize !== undefined ? options.maxContextSize : (env.DEFAULT_MAX_CONTEXT_SIZE ?? 4000);
    const temperature = options.temperature !== undefined ? options.temperature : 0;
    const timeout = options.timeout !== undefined ? options.timeout : 25000;
    let model = options.model !== undefined ? options.model : env.DEFAULT_CHAT_MODEL;

    // A. Resolve document scope from the question or filters
    const resolvedDocs = await ChatService.resolveDocuments(question, options.filters);
    const activeFilters: any = { ...options.filters };

    if (resolvedDocs.length === 1) {
      activeFilters.documentId = resolvedDocs[0].documentId;
    } else if (resolvedDocs.length > 1) {
      activeFilters.documentIds = resolvedDocs.map(d => d.documentId);
      delete activeFilters.documentId;
    }

    // 2. Perform Semantic Search
    let searchResults = [];
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
        const combinedResults = individualResults.flat();
        combinedResults.sort((a, b) => b.score - a.score);

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
    } catch (error: any) {
      logger.error("Erro na busca vetorial para diagnóstico", error);
      throw error;
    }

    const resultsCount = searchResults.length;

    // 3. Retrieve Filenames for the retrieved Document IDs
    const docIds = Array.from(new Set(searchResults.map((r) => r.documentId)));
    const docMap = new Map<string, string>();
    if (docIds.length > 0) {
      try {
        const { data: matchedDocs, error: docError } = await supabase
          .from("knowledge_documents")
          .select("id, file_name")
          .in(// @ts-ignore
            "id", docIds);

        if (!docError && matchedDocs) {
          for (const d of matchedDocs) {
            docMap.set(d.id, d.file_name);
          }
        }
      } catch (error: any) {
        logger.error("Erro ao carregar nomes de arquivos no diagnóstico", error);
      }
    }

    const chunksToProcess = searchResults.map(r => ({
      ...r,
      documentName: docMap.get(r.documentId) || r.metadata?.sourceDocument || "Desconhecido",
    }));

    // 4. Build Context
    const { context, selectedChunks: finalUsedChunks } = ContextBuilderService.buildContextDetailed(chunksToProcess, maxContextSize);

    const systemPrompt = PromptBuilderService.buildSystemPrompt();
    const userPrompt = PromptBuilderService.buildUserPrompt(question, context);

    let answer = "";
    if (finalUsedChunks.length > 0) {
      try {
        answer = await chatWithContextConfigurable(question, context, {
          model,
          temperature,
          timeout,
          systemPrompt,
          userPrompt,
        });
      } catch (error: any) {
        answer = `Erro ao invocar LLM no diagnóstico: ${error.message}`;
      }
    } else {
      answer = "Não encontrei essa informação na base de conhecimento (diagnóstico: contexto de suporte vazio/insuficiente).";
    }

    // Build lists for diagnostic output
    const processedChunksInfo = chunksToProcess.map(c => ({
      id: (c as any).id,
      documentId: c.documentId,
      filename: c.documentName,
      chunkIndex: c.chunkIndex,
      score: c.score,
      similarity: c.score,
      page: c.metadata?.pageNumber || (c as any).page || "não especificado",
      text: c.text,
      usedInContext: finalUsedChunks.some(f => f.documentId === c.documentId && f.chunkIndex === c.chunkIndex),
    }));

    const uniqueDocNames = Array.from(new Set(processedChunksInfo.map(c => c.filename)));
    const uniquePages = Array.from(new Set(processedChunksInfo.map(c => c.page).filter(p => p !== "não especificado")));

    return {
      pergunta: question,
      embedding_gerado: embedding,
      chunks_encontrados: processedChunksInfo,
      score: {
        total_encontrados: resultsCount,
        max_score: resultsCount > 0 ? Math.max(...searchResults.map(r => r.score)) : 0,
        avg_score: resultsCount > 0 ? searchResults.reduce((sum, r) => sum + r.score, 0) / resultsCount : 0,
        threshold_utilizado: scoreThreshold
      },
      documentos: uniqueDocNames,
      paginas: uniquePages,
      "páginas": uniquePages,
      contexto_final: context,
      prompt_enviado: {
        systemPrompt,
        userPrompt,
        completo: `=== SYSTEM ===\n${systemPrompt}\n\n=== USER ===\n${userPrompt}`
      },
      resposta_do_modelo: answer,
      metadata: {
        model,
        temperature,
        topK,
        duration_ms: parseFloat((performance.now() - overallStartTime).toFixed(2))
      }
    };
  }

  /**
   * Generates formatted vertical structured logging of the RAG pipeline flow.
   */
  private static logRagPipelineFlow(
    question: string,
    resultsCount: number,
    topScore: number,
    docNames: string[],
    pages: (string | number)[],
    articles: string[],
    contextLength: number,
    answer: string
  ): void {
    const formattedDocs = docNames.length > 0 ? docNames.join(", ") : "Nenhum";
    const formattedPages = pages.length > 0 ? pages.join(", ") : "Nenhuma";
    const formattedArticles = articles.length > 0 ? articles.join(", ") : "Nenhum";
    const responseExcerpt = answer.length > 100 ? `${answer.substring(0, 100)}...` : answer;

    const logBlock = `
=== PIPELINE RAG AUDIT LOG ===
Consulta: "${question}"
↓
Embedding OK
↓
Busca vetorial OK
↓
${resultsCount} chunks encontrados
↓
Top score: ${topScore.toFixed(4)}
↓
Documento:
${formattedDocs}
↓
Página:
${formattedPages}
↓
Artigo:
${formattedArticles}
↓
Contexto:
${contextLength.toLocaleString("pt-BR")} caracteres
↓
Groq
↓
Resposta: "${responseExcerpt}"
==============================
`;
    console.log(logBlock);
    logger.info("Pipeline RAG executado", {
      question: "[REDACTED]",
      resultsCount,
      topScore,
      documents: docNames,
      pages,
      articles,
      contextLength,
    });
  }
}
