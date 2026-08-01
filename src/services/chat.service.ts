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

    // 2. Perform Semantic Search
    let searchResults = [];
    const searchStartTime = performance.now();
    try {
      searchResults = await SearchService.search(
        question,
        topK,
        scoreThreshold,
        options.filters
      );
    } catch (error: any) {
      logger.error("Erro na busca vetorial do banco vetorial", error);
      const err = new Error(`Erro na busca vetorial da base de dados: ${error.message}`);
      (err as any).status = 500;
      throw err;
    }
    const searchTimeMs = performance.now() - searchStartTime;

    // 3. Handle Empty Context Scenario
    if (searchResults.length === 0) {
      const overallDuration = performance.now() - overallStartTime;
      logger.info("Fluxo de Chat concluído com contexto vazio", {
        searchTimeMs: parseFloat(searchTimeMs.toFixed(2)),
        generationTimeMs: 0,
        totalTimeMs: parseFloat(overallDuration.toFixed(2)),
        documentsCount: 0,
        chunksCount: 0,
      });

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

    // 5. Track exact chunks utilized inside the context building constraint
    const seenTexts = new Set<string>();
    const uniqueChunks = [];
    for (const r of searchResults) {
      const norm = (r?.text ?? "").trim().toLowerCase();
      if (!seenTexts.has(norm)) {
        seenTexts.add(norm);
        uniqueChunks.push(r);
      }
    }
    uniqueChunks.sort((a, b) => {
      const docA = a?.documentId ?? "";
      const docB = b?.documentId ?? "";
      if (docA !== docB) {
        return docA.localeCompare(docB);
      }
      const indexA = a?.chunkIndex ?? 0;
      const indexB = b?.chunkIndex ?? 0;
      return indexA - indexB;
    });

    const finalUsedChunks = [];
    let currentContextText = "";
    for (const chunk of uniqueChunks) {
      const chunkText = (chunk?.text ?? "").trim();
      if (!chunkText) continue;

      if (currentContextText === "") {
        if (chunkText.length > maxContextSize) {
          currentContextText = chunkText.substring(0, maxContextSize);
          finalUsedChunks.push(chunk);
        } else {
          currentContextText = chunkText;
          finalUsedChunks.push(chunk);
        }
      } else {
        const potentialNext = currentContextText + "\n\n" + chunkText;
        if (potentialNext.length <= maxContextSize) {
          currentContextText = potentialNext;
          finalUsedChunks.push(chunk);
        } else {
          break;
        }
      }
    }

    // 6. Build Context and Prompts
    const context = ContextBuilderService.buildContext(searchResults, maxContextSize);
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
      logger.error("Falha ao invocar LLM no ChatService", error);
      const isTimeout = error.message && error.message.includes("tempo limite");
      const err = new Error(
        isTimeout
          ? `O tempo limite de processamento de ${timeout}ms foi excedido.`
          : `Falha ao gerar resposta do Groq: ${error.message}`
      );
      (err as any).status = isTimeout ? 504 : 502;
      throw err;
    }
    const generationTimeMs = performance.now() - generationStartTime;

    const overallDuration = performance.now() - overallStartTime;

    // 8. Build Structured Sources List
    const sources: ChatSource[] = finalUsedChunks.map((c) => ({
      documentId: c.documentId,
      filename: docMap.get(c.documentId) || "Desconhecido",
      chunkIndex: c.chunkIndex,
      score: parseFloat(c.score.toFixed(4)),
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
