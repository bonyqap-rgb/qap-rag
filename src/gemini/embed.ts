import { GoogleGenAI } from "@google/genai";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";

const ai = new GoogleGenAI({
  apiKey: env.GOOGLE_API_KEY,
});

export async function createEmbedding(text: string): Promise<number[]> {
  const response = await ai.models.embedContent({
    model: "gemini-embedding-001",
    contents: text,
  });

  const embedding = response.embeddings?.[0]?.values;

  if (!embedding) {
    throw new Error("Não foi possível gerar o embedding.");
  }

  logger.info(`Embedding length: ${embedding.length}`);

  return embedding;
}
