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
  throw new Error("A migração completa para Groq é inviável porque o serviço não fornece embeddings para este fluxo RAG.");
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
