import { GoogleGenAI } from "@google/genai";
import { env } from "../config/env.js";
import { logger } from "./logger.service.js";

const ai = new GoogleGenAI({
  apiKey: env.GOOGLE_API_KEY,
});

/**
 * Generates an embedding vector for a given piece of text using Google GenAI.
 * @param text The input string to embed
 * @returns An array of numbers representing the embedding vector
 */
export async function createEmbedding(text: string): Promise<number[]> {
  const response = await ai.models.embedContent({
    model: "gemini-embedding-001",
    contents: text,
  });

  const embedding = response.embeddings?.[0]?.values;

  if (!embedding) {
    throw new Error("Não foi possível gerar o embedding.");
  }

  logger.info(`Embedding length generated: ${embedding.length}`);

  return embedding;
}
