import { createEmbedding } from "../../gemini/embed.js";

export class EmbeddingService {
  /**
   * Generates a vector embedding for the given text using Google Gemini api,
   * complete with error retry-with-backoff, timeouts, and results caching.
   *
   * @param text - The text to embed
   * @returns Promise resolving to the number array embedding vector
   */
  public async generateEmbedding(text: string): Promise<number[]> {
    return createEmbedding(text);
  }
}
