import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const ai = new GoogleGenAI({
  apiKey: process.env.GOOGLE_API_KEY!,
});

/**
 * Generates an embedding vector for a given segment of text using Google GenAI models.
 * Automatically validates input text.
 *
 * @param text - The text to create an embedding vector for
 * @returns Array of numbers representing the embedding vector
 */
export async function createEmbedding(text: string): Promise<number[]> {
  if (!text || typeof text !== "string" || text.trim() === "") {
    throw new Error("O texto para geração de embedding não pode ser vazio.");
  }

  const response = await ai.models.embedContent({
    model: "gemini-embedding-001",
    contents: text,
  });

  const embedding = response.embeddings?.[0]?.values;

  if (!embedding) {
    throw new Error("Não foi possível gerar o embedding.");
  }

  console.log(`[EMBEDDING] Gerado vetor com tamanho: ${embedding.length}`);

  return embedding;
}
