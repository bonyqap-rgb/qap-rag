import { env } from "../config/env.js";

export interface ContextChunkInput {
  documentId: string;
  chunkIndex: number;
  text: string;
  score?: number;
}

export class ContextBuilderService {
  /**
   * Builds a clean context from the retrieved chunks.
   * - Eliminates duplicates by lowercased, trimmed text content.
   * - Sorts the chunks by documentId first, then by chunkIndex ascending to preserve original order.
   * - Appends chunks separated by double newlines until the maximum context size limit is reached.
   *
   * @param chunks - List of retrieved chunks
   * @param maxContextSize - Maximum character length of the context
   * @returns Clean context string
   */
  static buildContext(
    chunks: ContextChunkInput[],
    maxContextSize: number = env.DEFAULT_MAX_CONTEXT_SIZE
  ): string {
    if (!chunks || chunks.length === 0) {
      return "";
    }

    // 1. Eliminate duplicates
    const uniqueChunks: ContextChunkInput[] = [];
    const seenTexts = new Set<string>();

    for (const chunk of chunks) {
      const normalizedText = (chunk?.text ?? "").trim().toLowerCase();
      if (!seenTexts.has(normalizedText)) {
        seenTexts.add(normalizedText);
        uniqueChunks.push(chunk);
      }
    }

    // 2. Sort to preserve document order (by documentId, then chunkIndex ascending)
    const sortedChunks = [...uniqueChunks].sort((a, b) => {
      if (a.documentId !== b.documentId) {
        return a.documentId.localeCompare(b.documentId);
      }
      return a.chunkIndex - b.chunkIndex;
    });

    // 3. Construct context respecting maximum context size
    let context = "";
    for (const chunk of sortedChunks) {
      const chunkText = chunk.text.trim();
      if (!chunkText) continue;

      if (context === "") {
        if (chunkText.length > maxContextSize) {
          context = chunkText.substring(0, maxContextSize);
        } else {
          context = chunkText;
        }
      } else {
        const potentialNext = context + "\n\n" + chunkText;
        if (potentialNext.length <= maxContextSize) {
          context = potentialNext;
        } else {
          // If the next chunk cannot fit completely, do not include it
          break;
        }
      }
    }

    return context;
  }
}
