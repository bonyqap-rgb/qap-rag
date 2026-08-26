/**
 * Splits normalized text into semantic-aware chunks.
 * For legal texts, preserves each Artigo as the primary chunk boundary so
 * retrieval can return the requested article instead of a mixed group of articles.
 * Long articles are split only inside the same article, never across article boundaries.
 * Tracks page numbers dynamically based on embedded [PAGE_MARKER:X] tags.
 */
export function createChunks(
  text: string,
  chunkSize = 1000,
  overlap = 200
): string[] {
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
      continue;
    }

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

  // Detect legal texts without changing the existing behavior for ordinary documents.
  const articleStart = /^(?:Art(?:igo)?\.?)[\s]*\d+[ºo]?\.?\b/i;
  const articleCount = segments.filter((segment) => articleStart.test(segment.text)).length;
  const isLegalText = articleCount >= 2;

  if (isLegalText) {
    return createLegalChunks(segments, chunkSize, overlap);
  }

  return createSemanticChunks(segments, chunkSize, overlap);

  function createLegalChunks(items: TextSegment[], maxSize: number, overlapSize: number): string[] {
    const articleBlocks: TextSegment[][] = [];
    let currentArticle: TextSegment[] = [];

    for (const segment of items) {
      if (articleStart.test(segment.text) && currentArticle.length > 0) {
        articleBlocks.push(currentArticle);
        currentArticle = [];
      }
      currentArticle.push(segment);
    }

    if (currentArticle.length > 0) {
      articleBlocks.push(currentArticle);
    }

    const result: string[] = [];

    for (const article of articleBlocks) {
      // Preserve the complete article when it fits in one chunk.
      const articleLength = article.reduce((sum, item, index) => sum + item.text.length + (index > 0 ? 1 : 0), 0);
      if (articleLength <= maxSize) {
        pushLegalChunk(article);
        continue;
      }

      // Very long articles are split internally, with overlap limited to the same article.
      let current: TextSegment[] = [];
      let currentLength = 0;

      for (const segment of article) {
        if (segment.text.length >= maxSize) {
          if (current.length > 0) {
            pushLegalChunk(current);
            current = [];
            currentLength = 0;
          }
          pushLegalChunk([segment]);
          continue;
        }

        if (currentLength + segment.text.length + (current.length > 0 ? 1 : 0) > maxSize) {
          pushLegalChunk(current);

          const overlapSegments: TextSegment[] = [];
          let overlapLength = 0;
          let j = current.length - 1;
          while (j >= 0 && overlapLength + current[j].text.length + 1 <= overlapSize) {
            overlapSegments.unshift(current[j]);
            overlapLength += current[j].text.length + 1;
            j--;
          }

          current = [...overlapSegments, segment];
          currentLength = overlapLength + segment.text.length;
        } else {
          current.push(segment);
          currentLength += segment.text.length + (current.length > 1 ? 1 : 0);
        }
      }

      if (current.length > 0) {
        pushLegalChunk(current);
      }
    }

    return result;

    function pushLegalChunk(articleSegments: TextSegment[]) {
      if (articleSegments.length === 0) return;
      const page = dominantPage(articleSegments);
      result.push(`[PAGE:${page}] ${articleSegments.map((item) => item.text).join(" ")}`);
    }
  }

  function createSemanticChunks(items: TextSegment[], maxSize: number, overlapSize: number): string[] {
    const result: string[] = [];
    let currentChunkSegments: TextSegment[] = [];
    let currentChunkLength = 0;

    for (let i = 0; i < items.length; i++) {
      const segment = items[i];

      if (segment.text.length >= maxSize) {
        if (currentChunkSegments.length > 0) {
          pushChunk(currentChunkSegments);
          currentChunkSegments = [];
          currentChunkLength = 0;
        }
        result.push(`[PAGE:${segment.page}] ${segment.text}`);
        continue;
      }

      if (currentChunkLength + segment.text.length + 1 > maxSize) {
        pushChunk(currentChunkSegments);

        const overlapSegments: TextSegment[] = [];
        let overlapLength = 0;
        let j = i - 1;

        while (j >= 0 && overlapLength + items[j].text.length + 1 <= overlapSize) {
          overlapSegments.unshift(items[j]);
          overlapLength += items[j].text.length + 1;
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

    return result;

    function pushChunk(segList: TextSegment[]) {
      if (segList.length === 0) return;
      const page = dominantPage(segList);
      result.push(`[PAGE:${page}] ${segList.map((item) => item.text).join(" ")}`);
    }
  }

  function dominantPage(items: TextSegment[]): number {
    const pageCounts: Record<number, number> = {};
    for (const item of items) {
      pageCounts[item.page] = (pageCounts[item.page] || 0) + 1;
    }

    let page = items[0]?.page || 1;
    let maxCount = 0;
    for (const [candidate, count] of Object.entries(pageCounts)) {
      if (count > maxCount) {
        maxCount = count;
        page = parseInt(candidate, 10);
      }
    }
    return page;
  }
}
