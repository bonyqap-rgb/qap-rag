import dotenv from "dotenv";
import Groq from "groq-sdk";
import { env } from "../config/env.js";
import { embeddingCache, generateHashKey } from "../services/cache.service.js";
import { groqEmbeddingCircuitBreaker } from "../services/circuit-breaker.service.js";

dotenv.config();

const groq = new Groq({
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
      const backoffDelay = delayMs * Math.pow(2, attempt - 1);
      console.warn(`[RETRY] Tentativa de Embedding ${attempt} falhou. Retentando em ${backoffDelay}ms... Erro: ${error.message || error}`);
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
    console.log(`[EMBEDDING CACHE] Retornando vetor em cache para: "${normalizedText.substring(0, 30)}..."`);
    return cached;
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
            throw new Error(`Erro na API do Voyage AI (${res.status}): ${text}`);
          }
          const data = await res.json() as any;
          const embedding = data.data?.[0]?.embedding;
          if (!embedding) {
            throw new Error("Resposta da API de embedding do Voyage AI inválida ou vazia.");
          }
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
            throw new Error(`Erro na API do Nomic (${res.status}): ${text}`);
          }
          const data = await res.json() as any;
          const embedding = data.embeddings?.[0];
          if (!embedding) {
            throw new Error("Resposta da API de embedding do Nomic inválida ou vazia.");
          }
          return embedding;
        } else {
          throw new Error("Provedor de embedding não configurado. Defina VOYAGE_API_KEY ou NOMIC_API_KEY no arquivo .env.");
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

  // Pad the 768-dimensional vector to 1536 dimensions with zeros for perfect pgvector dimension matching
  const targetDimension = 1536;
  const paddedEmbedding = [...embeddingData];
  while (paddedEmbedding.length < targetDimension) {
    paddedEmbedding.push(0);
  }

  // Populate cache for subsequent operations
  embeddingCache.set(cacheKey, paddedEmbedding);

  return paddedEmbedding;
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
