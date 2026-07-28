/**
 * Splits a long text string into smaller overlapping chunks.
 * Attempts to respect word or sentence boundaries (spaces, punctuation) near the chunk end
 * to avoid truncating words or phrases mid-sentence, falling back to character-based slicing
 * if no clean boundaries are found within the search window.
 *
 * @param text - The original input text string
 * @param chunkSize - The maximum target character length for each chunk (default 1000)
 * @param overlap - The amount of character overlap between consecutive chunks (default 200)
 * @returns An array of text chunks
 */
export function createChunks(
  text: string,
  chunkSize = 1000,
  overlap = 200
): string[] {
  const chunks: string[] = [];
  const textLength = text.length;
  let start = 0;

  while (start < textLength) {
    let end = start + chunkSize;

    // If the chunk goes to the end of the text, just take it
    if (end >= textLength) {
      chunks.push(text.slice(start, textLength));
      break;
    }

    // Search window for word boundaries: look back up to 80 chars from the chunk end
    const lookbackLimit = Math.max(start, end - 80);
    let boundaryIndex = -1;

    for (let i = end; i > lookbackLimit; i--) {
      const char = text[i];
      // Splitting on space or sentence ends (period, question, exclamation + space)
      if (char === " " || char === "\n") {
        boundaryIndex = i;
        break;
      }
    }

    // If a clean boundary was found, split there. Otherwise, fall back to character slice.
    if (boundaryIndex !== -1) {
      end = boundaryIndex;
    }

    const chunk = text.slice(start, end).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }

    // Slide window forward accounting for overlap
    start = end - overlap;

    // Safety check to prevent infinite loop if overlap is larger than chunk size
    if (start >= end) {
      start = end;
    }
  }

  return chunks;
}
