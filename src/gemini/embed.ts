import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const ai = new GoogleGenAI({
  apiKey: process.env.GOOGLE_API_KEY!,
});

// Simple, high-performance in-memory cache to skip duplicate embedding generations
const embeddingCache = new Map<string, number[]>();

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
  retries = 3,
  delayMs = 1000
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

  // Return cached result if already computed to avoid redundant API queries
  if (embeddingCache.has(normalizedText)) {
    console.log(`[EMBEDDING CACHE] Retornando vetor em cache para: "${normalizedText.substring(0, 30)}..."`);
    return embeddingCache.get(normalizedText)!;
  }

  // Define the core API operation with a 15-second timeout protection
  const apiCall = () =>
    withTimeout(
      ai.models.embedContent({
        model: "gemini-embedding-001",
        contents: normalizedText,
      }),
      15000
    );

  // Execute the API call with exponential backoff retry on transient issues
  const response = await retryWithBackoff(apiCall, 3, 1000);

  const embedding = response.embeddings?.[0]?.values;

  // Validate the resulting embedding vector
  if (!embedding || !Array.isArray(embedding) || embedding.length === 0) {
    throw new Error("Resposta da API de embedding inválida ou vazia.");
  }

  // Populate cache for subsequent operations
  embeddingCache.set(normalizedText, embedding);

  return embedding;
}
