export class ChunkerService {
  private chunkSize: number;
  private overlap: number;

  constructor(chunkSize = 1000, overlap = 200) {
    this.chunkSize = chunkSize;
    this.overlap = overlap;
  }

  /**
   * Splits normalized text into semantic-aware chunks.
   * Groups whole sentences together, avoiding splitting sentences across chunks.
   * Tracks and embeds page numbers dynamically based on embedded [PAGE_MARKER:X] tags.
   *
   * @param text - Normalized document text with embedded page markers
   * @returns Array of chunk strings, each prefixed with its extracted page marker [PAGE:X]
   */
  public splitText(text: string): string[] {
    const chunks: string[] = [];
    if (!text || text.trim() === "") return chunks;

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

      const pageMatch = trimmed.match(/^\[PAGE_MARKER:(\d+)\]$/);
      if (pageMatch) {
        currentPage = parseInt(pageMatch[1], 10);
      } else {
        const sentences = trimmed.split(/(?<=[.?!])\s+/);
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

    const pushChunk = (segList: TextSegment[]) => {
      if (segList.length === 0) return;
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
    };

    let currentChunkSegments: TextSegment[] = [];
    let currentChunkLength = 0;

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];

      if (segment.text.length >= this.chunkSize) {
        if (currentChunkSegments.length > 0) {
          pushChunk(currentChunkSegments);
          currentChunkSegments = [];
          currentChunkLength = 0;
        }
        chunks.push(`[PAGE:${segment.page}] ${segment.text}`);
        continue;
      }

      if (currentChunkLength + segment.text.length + 1 > this.chunkSize) {
        pushChunk(currentChunkSegments);

        const overlapSegments: TextSegment[] = [];
        let overlapLength = 0;
        let j = i - 1;

        while (j >= 0 && overlapLength + segments[j].text.length + 1 <= this.overlap) {
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

    return chunks;
  }
}
