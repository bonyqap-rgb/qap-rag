/**
 * Creates smaller overlapping text chunks from a large text block.
 * @param text The input text to chunk
 * @param chunkSize Maximum size of each chunk
 * @param overlap Overlap size between consecutive chunks
 * @returns Array of text chunks
 */
export function createChunks(
  text: string,
  chunkSize = 1000,
  overlap = 200
): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = start + chunkSize;
    chunks.push(text.slice(start, end));
    start += chunkSize - overlap;
  }

  return chunks;
}
