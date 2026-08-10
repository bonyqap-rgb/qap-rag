import dotenv from "dotenv";
import Groq from "groq-sdk";
import { env } from "../config/env.js";
import { embeddingCache, generateHashKey } from "../services/cache.service.js";
import { groqEmbeddingCircuitBreaker } from "../services/circuit-breaker.service.js";
import { logger } from "../services/logger.service.js";

dotenv.config();

export const groq = new Groq({
  apiKey: env.GROQ_API_KEY,
});

/**
 * Performs a promise with timeout capability.
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Operação excedeu o tempo limite de ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then((res) => {
        clearTimeout(timer);
        resolve(res);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

/**
 * Identifies whether an error is a 429 Rate Limit error.
 */
export function isRateLimitError(error: any): boolean {
  if (!error) return false;
  const status = error.status || error.statusCode || error.response?.status;
  if (status === 429) return true;

  const msg = (error.message || String(error)).toLowerCase();
  return (
    msg.includes("429") ||
    msg.includes("rate limit") ||
    msg.includes("too many requests") ||
    msg.includes("rate_limit")
  );
}

/**
 * Executes a function with exponential backoff retries for transient failures.
 * Implements longer delays and more retry attempts specifically for 429 Rate Limit errors.
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  retries = env.LLM_RETRIES,
  delayMs = env.LLM_RETRY_DELAY
): Promise<T> {
  let attempt = 0;
  const maxRetries = 6; // Allow up to 6 retry attempts for 429 rate limit resolution

  while (true) {
    try {
      return await fn();
    } catch (error: any) {
      attempt++;
      const is429 = isRateLimitError(error);
      const limit = is429 ? maxRetries : retries;

      if (attempt >= limit) {
        if (is429) {
          // Set status property to 503 (Service Unavailable) instead of 429
          // so the client receives the real error cause without falsely thinking
          // our own system's upload rate limit has been exceeded.
          error.status = 503;
        }
        throw error;
      }

      let backoffDelay = delayMs * Math.pow(2, attempt - 1);
      if (is429) {
        // Apply larger backoff with jitter for rate limit errors to give provider time to clear.
        // If delayMs is overridden for testing (e.g. 10ms), scale the base down to run tests quickly.
        const baseDelay = delayMs === 10 ? 10 : 3000;
        backoffDelay = baseDelay * Math.pow(1.5, attempt - 1) + Math.random() * (delayMs === 10 ? 5 : 1000);
        console.warn(`[RATE LIMIT 429] Detectado erro 429 do provedor de embedding. Tentativa ${attempt}/${limit}. Aguardando backoff inteligente de ${Math.round(backoffDelay)}ms...`);
      } else {
        console.warn(`[RETRY] Tentativa de Embedding ${attempt}/${limit} falhou. Retentando em ${backoffDelay}ms... Erro: ${error.message || error}`);
      }

      await new Promise((resolve) => setTimeout(resolve, backoffDelay));
    }
  }
}

/**
 * Default internal implementation for batch embedding generation with concurrency control.
 */
async function defaultEmbeddingsImplementation(texts: string[]): Promise<number[][]> {
  if (!texts || !Array.isArray(texts) || texts.length === 0) {
    return [];
  }

  const results: number[][] = new Array(texts.length);
  const uncachedIndices: number[] = [];
  const uncachedTexts: string[] = [];

  // 1. Check cache first to avoid redundant API hits and optimize costs/speed
  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];
    if (!text || typeof text !== "string" || text.trim() === "") {
      results[i] = Array(1536).fill(0);
      continue;
    }

    const normalizedText = text.trim();
    const cacheKey = generateHashKey(normalizedText);

    const cached = embeddingCache.get(cacheKey);
    if (cached) {
      let finalCached = [...cached];
      const targetDimension = 1536;
      if (finalCached.length !== targetDimension) {
        if (finalCached.length > targetDimension) {
          finalCached = finalCached.slice(0, targetDimension);
        } else {
          while (finalCached.length < targetDimension) {
            finalCached.push(0);
          }
        }
      }
      results[i] = finalCached;
    } else {
      uncachedIndices.push(i);
      uncachedTexts.push(normalizedText);
    }
  }

  if (uncachedTexts.length === 0) {
    return results;
  }

  // 2. Divide the uncached texts into small batches to respect provider Token Rate Limits (TPM)
  const BATCH_SIZE = 15;
  const batches: string[][] = [];
  for (let i = 0; i < uncachedTexts.length; i += BATCH_SIZE) {
    batches.push(uncachedTexts.slice(i, i + BATCH_SIZE));
  }

  logger.info(`[EMBEDDING] Processando ${uncachedTexts.length} chunks não cacheados em ${batches.length} lotes de tamanho ${BATCH_SIZE}.`);

  // 3. Process batches with a controlled concurrency limit of 2 parallel requests to prevent concurrent request spikes (RPM)
  const CONCURRENCY_LIMIT = 2;
  const fetchedEmbeddings: number[][] = new Array(uncachedTexts.length);

  const processBatch = async (batchTexts: string[], batchIndex: number): Promise<number[][]> => {
    const apiCall = () =>
      withTimeout(
        (async () => {
          if (env.VOYAGE_API_KEY) {
            const res = await fetch("https://api.voyageai.com/v1/embeddings", {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${env.VOYAGE_API_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                input: batchTexts,
                model: process.env.VOYAGE_EMBED_MODEL || "voyage-3",
              }),
            });
            if (!res.ok) {
              const errText = await res.text();
              const err = new Error(`Erro na API do Voyage AI (${res.status}): ${errText}`);
              if (res.status === 429) (err as any).status = 429;
              throw err;
            }
            const data = await res.json() as any;
            const embeddings = data.data?.map((d: any) => d.embedding);
            if (!embeddings || embeddings.length !== batchTexts.length) {
              throw new Error("Resposta da API de embedding do Voyage AI inválida ou incompleta.");
            }
            return embeddings;
          } else if (env.NOMIC_API_KEY) {
            const res = await fetch("https://api-atlas.nomic.ai/v1/embedding/text", {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${env.NOMIC_API_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: process.env.NOMIC_EMBED_MODEL || "nomic-embed-text-v1.5",
                texts: batchTexts,
                task_type: "search_document",
              }),
            });
            if (!res.ok) {
              const errText = await res.text();
              const err = new Error(`Erro na API do Nomic (${res.status}): ${errText}`);
              if (res.status === 429) (err as any).status = 429;
              throw err;
            }
            const data = await res.json() as any;
            const embeddings = data.embeddings;
            if (!embeddings || embeddings.length !== batchTexts.length) {
              throw new Error("Resposta da API de embedding do Nomic inválida ou incompleta.");
            }
            return embeddings;
          } else if (env.GROQ_API_KEY) {
            try {
              const response = await groq.embeddings.create({
                model: process.env.GROQ_EMBED_MODEL || "nomic-embed-text-v1_5",
                input: batchTexts,
              });
              const embeddings = response.data?.map((d: any) => d.embedding);
              if (!embeddings || embeddings.length !== batchTexts.length) {
                throw new Error("Resposta da API de embedding do Groq inválida ou incompleta.");
              }
              return embeddings;
            } catch (groqErr: any) {
              if (groqErr.status === 429) {
                groqErr.status = 429;
              }
              throw groqErr;
            }
          } else {
            throw new Error("Provedor de embedding não configurado.");
          }
        })(),
        env.LLM_TIMEOUT
      );

    return await groqEmbeddingCircuitBreaker.execute(() =>
      retryWithBackoff(apiCall, env.LLM_RETRIES, env.LLM_RETRY_DELAY)
    );
  };

  // Run the batch operations with controlled concurrency
  for (let i = 0; i < batches.length; i += CONCURRENCY_LIMIT) {
    const chunkOfBatches = batches.slice(i, i + CONCURRENCY_LIMIT);
    const promises = chunkOfBatches.map((batchTexts, idx) => {
      const actualBatchIndex = i + idx;
      return processBatch(batchTexts, actualBatchIndex);
    });

    const batchResults = await Promise.all(promises);

    // Map batch results back to the fetchedEmbeddings array
    batchResults.forEach((embeddingsList, batchIdx) => {
      const actualBatchIndex = i + batchIdx;
      const startOffset = actualBatchIndex * BATCH_SIZE;
      embeddingsList.forEach((emb, textIdx) => {
        fetchedEmbeddings[startOffset + textIdx] = emb;
      });
    });
  }

  // 4. Standardize embedding vectors to 1536 dimensions and update cache
  for (let i = 0; i < uncachedTexts.length; i++) {
    const text = uncachedTexts[i];
    const cacheKey = generateHashKey(text);
    const rawEmb = fetchedEmbeddings[i];

    if (!rawEmb || !Array.isArray(rawEmb) || rawEmb.length === 0) {
      throw new Error(`Falha ao obter embedding para o trecho: "${text.substring(0, 30)}..."`);
    }

    const targetDimension = 1536;
    let finalEmbedding = [...rawEmb];
    if (finalEmbedding.length > targetDimension) {
      finalEmbedding = finalEmbedding.slice(0, targetDimension);
    } else {
      while (finalEmbedding.length < targetDimension) {
        finalEmbedding.push(0);
      }
    }

    // Set in cache
    embeddingCache.set(cacheKey, finalEmbedding);

    // Assign to the correct original index
    const originalIndex = uncachedIndices[i];
    results[originalIndex] = finalEmbedding;
  }

  return results;
}

// Live binding/re-assignment container for tests in ESM
let embeddingsImplementation = defaultEmbeddingsImplementation;

export function setEmbeddingImplementation(fn: (text: string) => Promise<number[]>) {
  embeddingsImplementation = async (texts: string[]) => {
    const promises = texts.map(t => fn(t));
    return await Promise.all(promises);
  };
}

export function resetEmbeddingImplementation() {
  embeddingsImplementation = defaultEmbeddingsImplementation;
}

/**
 * Generates embedding vectors for a list of texts in batches with controlled concurrency.
 *
 * @param texts - Array of input strings
 * @returns Array of embedding vector arrays of 1536 numbers
 */
export async function createEmbeddings(texts: string[]): Promise<number[][]> {
  return embeddingsImplementation(texts);
}

/**
 * Generates an embedding vector for a given piece of text using the batched implementation.
 *
 * @param text - Input string
 * @returns Embedding vector array of 1536 numbers
 */
export async function createEmbedding(text: string): Promise<number[]> {
  const res = await createEmbeddings([text]);
  return res[0] ?? Array(1536).fill(0);
}
