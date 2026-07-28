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