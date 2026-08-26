/**
 * Splits normalized text into semantic-aware chunks.
 * For legal texts, preserves each Artigo as the primary chunk boundary.
 * Long articles are split only inside the same article, never across article boundaries.
 * Tracks page numbers dynamically based on embedded [PAGE_MARKER:X] tags.
 */
export function createChunks(
  text: string,
  chunkSize = 1000,
  overlap = 200
): string[] {
  if (!text || text.trim() === "") return [];

  interface TextSegment {
    text: string;
    page: number;
  }

  const segments: TextSegment[] = [];
  let currentPage = 1;

  // Important: detect article headings BEFORE sentence splitting.
  // PDF extraction often produces lines such as:
  // "Infrações disciplinares Art. 19. ... Art. 20. ... Art. 23. ..."
  // Splitting into sentences first loses those article boundaries.
  const articleHeading = /(?:^|\s)(Art(?:igo)?\.?\s*\d+[ºo]?\s*\.?)(?=\s|$)/g;

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const pageMatch = trimmed.match(/^\[PAGE_MARKER:(\d+)\]$/);
    if (pageMatch) {
      currentPage = parseInt(pageMatch[1], 10);
      continue;
    }

    const matches = [...trimmed.matchAll(articleHeading)];

    if (matches.length === 0) {
      segments.push({ text: trimmed, page: currentPage });
      continue;
    }

    let cursor = 0;

    for (let index = 0; index < matches.length; index++) {
      const match = matches[index];
      const start = match.index ?? 0;
      const before = trimmed.slice(cursor, start).trim();
      if (before) {
        segments.push({ text: before, page: currentPage });
      }

      const articleStart = start + (match[0].length - match[1].length);
      const nextMatch = matches[index + 1];
      const end = nextMatch?.index ?? trimmed.length;
      const articleText = trimmed.slice(articleStart, end).trim();

      if (articleText) {
        segments.push({ text: articleText, page: currentPage });
      }

      cursor = end;
    }

    const tail = trimmed.slice(cursor).trim();
    if (tail) {
      segments.push({ text: tail, page: currentPage });
    }
  }

  const articleStart = /^(?:Art(?:igo)?\.?)\s*\d+[ºo]?(?:\s*\.|\s|$)/i;
  const articleCount = segments.filter((segment) => articleStart.test(segment.text)).length;
  const isLegalText = articleCount >= 2;

  return isLegalText
    ? createLegalChunks(segments, chunkSize, overlap)
    : createSemanticChunks(segments, chunkSize, overlap);

  function createLegalChunks(
    items: TextSegment[],
    maxSize: number,
    overlapSize: number
  ): string[] {
    const articleBlocks: TextSegment[][] = [];
    let currentArticle: TextSegment[] = [];
    const preamble: TextSegment[] = [];

    for (const segment of items) {
      if (articleStart.test(segment.text)) {
        if (currentArticle.length > 0) {
          articleBlocks.push(currentArticle);
        }
        currentArticle = [segment];
      } else if (currentArticle.length > 0) {
        currentArticle.push(segment);
      } else {
        preamble.push(segment);
      }
    }

    if (currentArticle.length > 0) {
      articleBlocks.push(currentArticle);
    }

    const result: string[] = [];

    // Keep document title/preamble separate from article chunks.
    if (preamble.length > 0) {
      result.push(`[PAGE:${dominantPage(preamble)}] ${preamble.map((item) => item.text).join(" ")}`);
    }

    for (const article of articleBlocks) {
      const articleLength = article.reduce(
        (sum, item, index) => sum + item.text.length + (index > 0 ? 1 : 0),
        0
      );

      if (articleLength <= maxSize) {
        pushLegalChunk(article);
        continue;
      }

      // Very long articles are split internally, never across article boundaries.
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

        if (
          currentLength +
            segment.text.length +
            (current.length > 0 ? 1 : 0) >
          maxSize
        ) {
          pushLegalChunk(current);

          const overlapSegments: TextSegment[] = [];
          let overlapLength = 0;
          let j = current.length - 1;

          while (
            j >= 0 &&
            overlapLength + current[j].text.length + 1 <= overlapSize
          ) {
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

      result.push(
        `[PAGE:${dominantPage(articleSegments)}] ${articleSegments
          .map((item) => item.text)
          .join(" ")}`
      );
    }
  }

  function createSemanticChunks(
    items: TextSegment[],
    maxSize: number,
    overlapSize: number
  ): string[] {
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

      if (
        currentChunkLength +
          segment.text.length +
          (currentChunkSegments.length > 0 ? 1 : 0) >
        maxSize
      ) {
        pushChunk(currentChunkSegments);

        const overlapSegments: TextSegment[] = [];
        let overlapLength = 0;
        let j = i - 1;

        while (
          j >= 0 &&
          overlapLength + items[j].text.length + 1 <= overlapSize
        ) {
          overlapSegments.unshift(items[j]);
          overlapLength += items[j].text.length + 1;
          j--;
        }

        currentChunkSegments = [...overlapSegments, segment];
        currentChunkLength = overlapLength + segment.text.length;
      } else {
        currentChunkSegments.push(segment);
        currentChunkLength +=
          segment.text.length + (currentChunkSegments.length > 1 ? 1 : 0);
      }
    }

    if (currentChunkSegments.length > 0) {
      pushChunk(currentChunkSegments);
    }

    return result;

    function pushChunk(segList: TextSegment[]) {
      if (segList.length === 0) return;

      result.push(
        `[PAGE:${dominantPage(segList)}] ${segList
          .map((item) => item.text)
          .join(" ")}`
      );
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
