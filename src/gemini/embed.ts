import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { env } from "../config/env.js";
import { embeddingCache, generateHashKey } from "../services/cache.service.js";
import { geminiCircuitBreaker } from "../services/circuit-breaker.service.js";

dotenv.config();

const ai = new GoogleGenAI({
  apiKey: process.env.GOOGLE_API_KEY!,
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
      console.warn(`[RETRY] Tentativa ${attempt} falhou. Retentando em ${backoffDelay}ms... Erro: ${error.message || error}`);
      await new Promise((resolve) => setTimeout(resolve, backoffDelay));
    }
  }
}

/**
 * Generates an embedding vector for a given piece of text.
 * Implements validation, caching, API timeouts, and transient error backoff retries.
 *
 * @param text - Input string
 * @returns Embedding vector array of numbers
 */
export async function createEmbedding(text: string): Promise<number[]> {
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
      ai.models.embedContent({
        model: "gemini-embedding-001",
        contents: normalizedText,
      }),
      env.LLM_TIMEOUT
    );

  // Execute the API call inside the Circuit Breaker with exponential backoff retry on transient issues
  const response = await geminiCircuitBreaker.execute(() =>
    retryWithBackoff(apiCall, env.LLM_RETRIES, env.LLM_RETRY_DELAY)
  );

  const embedding = response.embeddings?.[0]?.values;

  // Validate the resulting embedding vector
  if (!embedding || !Array.isArray(embedding) || embedding.length === 0) {
    throw new Error("Resposta da API de embedding inválida ou vazia.");
  }

  const EXPECTED_DIMENSION = 768;
  if (embedding.length !== EXPECTED_DIMENSION) {
    const errorMsg = `[EMBEDDING ERROR] Dimensão inválida retornada pelo modelo. Modelo: "gemini-embedding-001", dimensão recebida: ${embedding.length}, dimensão esperada: ${EXPECTED_DIMENSION}`;
    console.error(errorMsg);
    throw new Error(errorMsg);
  }

  // Populate cache for subsequent operations
  embeddingCache.set(cacheKey, embedding);

  return embedding;
}
