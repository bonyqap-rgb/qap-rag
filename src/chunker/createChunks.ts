/**
 * Splits normalized text into semantic-aware chunks.
 * Groups whole sentences and paragraphs together, avoiding splitting sentences
 * across chunks. Supports configurable chunk sizes and overlaps.
 * Tracks and embeds page numbers dynamically based on embedded [PAGE_MARKER:X] tags.
 *
 * @param text - Normalized document text with embedded page markers
 * @param chunkSize - Maximum characters per chunk
 * @param overlap - Character overlap between consecutive chunks
 * @returns Array of chunk strings, each prefixed with its extracted page marker [PAGE:X]
 */
export function createChunks(
  text: string,
  chunkSize = 1000,
  overlap = 200
): string[] {
  const chunks: string[] = [];
  if (!text || text.trim() === "") return chunks;

  // Split text by lines/paragraphs to parse page markers and locate blocks
  const lines = text.split("\n");
  let currentPage = 1;

  interface TextSegment {
    text: string;
    page: number;
  }

  const segments: TextSegment[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Check for page marker
    const pageMatch = trimmed.match(/^\[PAGE_MARKER:(\d+)\]$/);
    if (pageMatch) {
      currentPage = parseInt(pageMatch[1], 10);
    } else {
      // Split the line into sentences avoiding splitting on legal abbreviations (Art., Inc., Par., etc.)
      const sentences = splitIntoSentences(trimmed);
      for (const sentence of sentences) {
        if (sentence.trim()) {
          segments.push({
            text: sentence.trim(),
            page: currentPage,
          });
        }
      }
    }
  }

  // Group segments into semantic chunks
  let currentChunkSegments: TextSegment[] = [];
  let currentChunkLength = 0;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];

    // If a single segment is larger than chunkSize, we must push current chunk and handle it
    if (segment.text.length >= chunkSize) {
      if (currentChunkSegments.length > 0) {
        pushChunk(currentChunkSegments);
        currentChunkSegments = [];
        currentChunkLength = 0;
      }
      chunks.push(`[PAGE:${segment.page}] ${segment.text}`);
      continue;
    }

    if (currentChunkLength + segment.text.length + 1 > chunkSize) {
      pushChunk(currentChunkSegments);

      // Implement sentence-level overlap
      // Backtrack to find overlap segments
      const overlapSegments: TextSegment[] = [];
      let overlapLength = 0;
      let j = i - 1;

      while (j >= 0 && overlapLength + segments[j].text.length + 1 <= overlap) {
        overlapSegments.unshift(segments[j]);
        overlapLength += segments[j].text.length + 1;
        j--;
      }

      currentChunkSegments = [...overlapSegments, segment];
      currentChunkLength = overlapLength + segment.text.length;
    } else {
      currentChunkSegments.push(segment);
      currentChunkLength += segment.text.length + (currentChunkLength > 0 ? 1 : 0);
    }
  }

  if (currentChunkSegments.length > 0) {
    pushChunk(currentChunkSegments);
  }

  function pushChunk(segList: TextSegment[]) {
    if (segList.length === 0) return;
    // Track the dominant page of the segments in this chunk
    const pageCounts: Record<number, number> = {};
    for (const s of segList) {
      pageCounts[s.page] = (pageCounts[s.page] || 0) + 1;
    }
    let dominantPage = segList[0].page;
    let maxCount = 0;
    for (const [p, count] of Object.entries(pageCounts)) {
      if (count > maxCount) {
        maxCount = count;
        dominantPage = parseInt(p, 10);
      }
    }

    const chunkText = segList.map(s => s.text).join(" ");
    chunks.push(`[PAGE:${dominantPage}] ${chunkText}`);
  }

  return chunks;
}

/**
 * Splits text into sentences while avoiding splitting after legal abbreviations
 * such as Art., Inc., Par., Fls., Pág., Cap., Sec., Dr., Dra., Sr., Sra., n.º, etc.
 */
function splitIntoSentences(text: string): string[] {
  if (!text) return [];

  // Legal and common abbreviations regex that shouldn't trigger sentence end
  const abbrevRegex = /\b(?:Art|art|ART|Inc|inc|INC|Par|par|PAR|Pág|pág|pag|Pag|Fls|fls|Cap|cap|Sec|sec|Item|item|Dr|dr|Dra|dra|Sr|sr|Sra|sra|n|N|v\.g|i\.e|e\.g)\.$/i;

  const rawSplit = text.split(/(?<=[.?!])\s+/);
  const sentences: string[] = [];
  let buffer = "";

  for (const part of rawSplit) {
    if (!part.trim()) continue;

    if (buffer) {
      buffer += " " + part;
    } else {
      buffer = part;
    }

    const isAbbrev = abbrevRegex.test(buffer.trim());
    if (!isAbbrev) {
      sentences.push(buffer.trim());
      buffer = "";
    }
  }

  if (buffer.trim()) {
    sentences.push(buffer.trim());
  }

  return sentences;
}
