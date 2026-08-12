import dotenv from "dotenv";
import Groq from "groq-sdk";
import { env } from "../config/env.js";
import { embeddingCache, generateHashKey } from "../services/cache.service.js";
import { groqEmbeddingCircuitBreaker } from "../services/circuit-breaker.service.js";

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
 * Executes a function with exponential backoff retries for transient failures.
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  retries = env.LLM_RETRIES,
  delayMs = env.LLM_RETRY_DELAY
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error: any) {
      attempt++;
      if (attempt >= retries) {
        throw error;
      }

      let backoffDelay = delayMs * Math.pow(2, attempt - 1);

      // Detect HTTP 429 and check for Retry-After header
      const status = error.status || error.statusCode || (error.response && error.response.status);
      if (status === 429) {
        let retryAfterVal: string | null = null;
        if (error.headers) {
          retryAfterVal = error.headers.get?.("retry-after") || error.headers["retry-after"] || null;
        } else if (error.response?.headers) {
          retryAfterVal = error.response.headers.get?.("retry-after") || error.response.headers["retry-after"] || null;
        }

        if (retryAfterVal) {
          const seconds = parseInt(retryAfterVal, 10);
          if (!isNaN(seconds) && seconds > 0) {
            backoffDelay = seconds * 1000;
            console.warn(`[RETRY 429] Rate limit atingido. Cabeçalho Retry-After detectado: ${seconds}s. Aguardando ${backoffDelay}ms...`);
          }
        } else {
          console.warn(`[RETRY 429] Rate limit atingido sem cabeçalho Retry-After. Aplicando backoff de ${backoffDelay}ms...`);
        }
      } else {
        console.warn(`[RETRY] Tentativa de Embedding ${attempt} falhou. Retentando em ${backoffDelay}ms... Erro: ${error.message || error}`);
      }

      await new Promise((resolve) => setTimeout(resolve, backoffDelay));
    }
  }
}

/**
 * Default internal implementation for embedding generation.
 */
async function defaultEmbeddingImplementation(text: string): Promise<number[]> {
  if (!text || typeof text !== "string" || text.trim() === "") {
    throw new Error("O texto para geração de embedding não pode ser vazio.");
  }

  const normalizedText = text.trim();
  const cacheKey = generateHashKey(normalizedText);

  // Return cached result if already computed to avoid redundant API queries
  const cached = embeddingCache.get(cacheKey);
  if (cached) {
    console.log(`[EMBEDDING CACHE] Retornando vetor em cache para: "${normalizedText.substring(0, 30)}..." - dimensão cached: ${cached.length}`);
    let finalCached = [...cached];
    const targetDimension = 1536;
    if (finalCached.length !== targetDimension) {
      console.warn(`[EMBEDDING CACHE] Vetor em cache com dimensão incorreta: ${finalCached.length}. Forçando ajuste para ${targetDimension}...`);
      if (finalCached.length > targetDimension) {
        finalCached = finalCached.slice(0, targetDimension);
      } else {
        while (finalCached.length < targetDimension) {
          finalCached.push(0);
        }
      }
      embeddingCache.set(cacheKey, finalCached);
    }
    console.log(`[EMBEDDING] dimensão após qualquer transformação (do cache): ${finalCached.length}`);
    return finalCached;
  }

  // Define the core API operation with timeout protection
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
              input: [normalizedText],
              model: process.env.VOYAGE_EMBED_MODEL || "voyage-3",
            }),
          });
          if (!res.ok) {
            const text = await res.text();
            const err: any = new Error(`Erro na API do Voyage AI (${res.status}): ${text}`);
            err.status = res.status;
            err.headers = res.headers;
            throw err;
          }
          const data = await res.json() as any;
          const embedding = data.data?.[0]?.embedding;
          if (!embedding) {
            throw new Error("Resposta da API de embedding do Voyage AI inválida ou vazia.");
          }
          console.log(`[VOYAGE AI] dimensão original recebida da API: ${embedding.length}`);
          return embedding;
        } else if (env.NOMIC_API_KEY) {
          const res = await fetch("https://api-atlas.nomic.ai/v1/embedding/text", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${env.NOMIC_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: process.env.NOMIC_EMBED_MODEL || "nomic-embed-text-v1.5",
              texts: [normalizedText],
              task_type: "search_document",
            }),
          });
          if (!res.ok) {
            const text = await res.text();
            const err: any = new Error(`Erro na API do Nomic (${res.status}): ${text}`);
            err.status = res.status;
            err.headers = res.headers;
            throw err;
          }
          const data = await res.json() as any;
          const embedding = data.embeddings?.[0];
          if (!embedding) {
            throw new Error("Resposta da API de embedding do Nomic inválida ou vazia.");
          }
          console.log(`[NOMIC] dimensão original recebida da API: ${embedding.length}`);
          return embedding;
        } else if (env.GROQ_API_KEY) {
          // Generate embeddings using Groq SDK nomic-embed-text-v1_5 model as fallback/primary
          try {
            const response = await groq.embeddings.create({
              model: process.env.GROQ_EMBED_MODEL || "nomic-embed-text-v1_5",
              input: normalizedText,
            });
            const embedding = response.data?.[0]?.embedding;
            if (!embedding) {
              throw new Error("Resposta da API de embedding do Groq inválida ou vazia.");
            }
            console.log(`[GROQ] dimensão original recebida da API: ${embedding.length}`);
            return embedding;
          } catch (groqErr: any) {
            // Propagate HTTP status & response headers if available from Groq SDK error
            const err: any = new Error(groqErr.message || String(groqErr));
            err.status = groqErr.status || groqErr.statusCode || (groqErr.response && groqErr.response.status);
            err.headers = groqErr.headers || (groqErr.response && groqErr.response.headers);
            throw err;
          }
        } else {
          throw new Error("Provedor de embedding não configurado. Defina VOYAGE_API_KEY, NOMIC_API_KEY ou GROQ_API_KEY no arquivo .env.");
        }
      })(),
      env.LLM_TIMEOUT
    );

  // Execute the API call inside the Circuit Breaker with exponential backoff retry on transient issues
  const embeddingData = await groqEmbeddingCircuitBreaker.execute(() =>
    retryWithBackoff(apiCall, env.LLM_RETRIES, env.LLM_RETRY_DELAY)
  );

  // Validate the resulting embedding vector
  if (!embeddingData || !Array.isArray(embeddingData) || embeddingData.length === 0) {
    throw new Error("Resposta da API de embedding inválida ou vazia.");
  }

  const originalDimension = embeddingData.length;
  console.log(`[EMBEDDING] dimensão original recebida da API: ${originalDimension}`);

  // Adjust the embedding vector to be exactly 1536 dimensions for perfect pgvector compatibility.
  // Truncate if larger (e.g., 3072 dimensions) or pad with zeros if smaller (e.g., 768 or 1024 dimensions).
  const targetDimension = 1536;
  let finalEmbedding = [...embeddingData];
  if (finalEmbedding.length > targetDimension) {
    finalEmbedding = finalEmbedding.slice(0, targetDimension);
  } else {
    while (finalEmbedding.length < targetDimension) {
      finalEmbedding.push(0);
    }
  }

  console.log(`[EMBEDDING] dimensão após qualquer transformação: ${finalEmbedding.length}`);

  // Populate cache for subsequent operations
  embeddingCache.set(cacheKey, finalEmbedding);

  return finalEmbedding;
}

// Live binding/re-assignment container for tests in ESM
let embeddingImplementation = defaultEmbeddingImplementation;

export function setEmbeddingImplementation(fn: typeof defaultEmbeddingImplementation) {
  embeddingImplementation = fn;
}

export function resetEmbeddingImplementation() {
  embeddingImplementation = defaultEmbeddingImplementation;
}

/**
 * Generates an embedding vector for a given piece of text using Groq's nomic-embed-text-v1_5 model.
 * Since the database/pgvector is set to 1536 dimensions,
 * we pad the 768-dimensional Nomic embedding with 768 trailing zeros to reach 1536 dimensions.
 * This guarantees perfect database compatibility without altering tables, schemas, or existing data.
 *
 * Implements validation, caching, API timeouts, and transient error backoff retries.
 *
 * @param text - Input string
 * @returns Embedding vector array of 1536 numbers
 */
export async function createEmbedding(text: string): Promise<number[]> {
  return embeddingImplementation(text);
}

/**
 * Generates embeddings for a list of text chunks with a controlled low concurrency (maximum 2 parallel requests)
 * and active delay spacing to completely eliminate rate limit bursts.
 *
 * @param chunks - Array of text chunks
 * @returns Array of 1536-dimensional embedding vectors
 */
export async function createEmbeddingsForChunks(chunks: string[]): Promise<number[][]> {
  const results: number[][] = new Array(chunks.length);
  const concurrency = 2;
  const delayMs = 150; // Active delay spacing to prevent sudden bursts

  let index = 0;

  async function worker() {
    while (true) {
      const currentIndex = index++;
      if (currentIndex >= chunks.length) {
        break;
      }

      results[currentIndex] = await createEmbedding(chunks[currentIndex]);

      // Spaced delay between worker calls to prevent sudden spikes
      if (index < chunks.length) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  // Spawn parallel workers up to the concurrency limit
  const workers = Array.from({ length: Math.min(concurrency, chunks.length) }, worker);
  await Promise.all(workers);

  return results;
}
