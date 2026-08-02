import { env } from "../config/env.js";
import { logger } from "./logger.service.js";

export interface ContextChunkInput {
  documentId: string;
  chunkIndex: number;
  text: string;
  score?: number;
  documentName?: string;
  article?: string;
  paragraph?: string;
  section?: string;
  chapter?: string;
  item?: string;
  page?: string | number;
  metadata?: {
    sourceDocument?: string;
    pageNumber?: number;
    chunkIndex?: number;
    totalChunks?: number;
    createdAt?: string;
    [key: string]: any;
  };
}

export interface DetailedContextResult {
  context: string;
  selectedChunks: ContextChunkInput[];
}

/**
 * Extracts legal/military metadata structures (article, section, etc.) from Portuguese text chunks using regex.
 */
export function extractMetadataFromText(text: string): {
  article?: string;
  paragraph?: string;
  section?: string;
  chapter?: string;
  item?: string;
} {
  const meta: {
    article?: string;
    paragraph?: string;
    section?: string;
    chapter?: string;
    item?: string;
  } = {};

  if (!text) return meta;

  // 1. Article: match "Artigo 31", "Art. 31", "Art 31", "Art. 31-A", "Artigo 31-A"
  const artMatch = text.match(/\b(?:Artigo|Art\.)\s*(\d+(?:-[A-Za-z\d]+)?\b[ºª]?|\d+)/i);
  if (artMatch) {
    meta.article = artMatch[1];
  }

  // 2. Paragraph: match "Parágrafo único", "Parágrafo 1º", "§ 1º", "§ 2º"
  const parMatch = text.match(/(?:Parágrafo|Parágrafos|Paragrafos|Paragrafo)\s*(Único|Unico|\d+\s*[ºª]?)|(§\s*\d+\s*[ºª]?)/i);
  if (parMatch) {
    meta.paragraph = parMatch[1] || parMatch[2];
  }

  // 3. Section: match "Seção I", "Seção II", "Secão III", "Seção de Competência"
  const secMatch = text.match(/\b(?:Seção|Secão|Secao|Sec\.)\s+([IVXLCDM\d]+|[^,\n\.\s]{3,})/i);
  if (secMatch) {
    meta.section = secMatch[1];
  }

  // 4. Chapter: match "Capítulo IV", "Capitulo V"
  const chapMatch = text.match(/\b(?:Capítulo|Capitulo|Cap\.)\s+([IVXLCDM\d]+|[^,\n\.\s]{3,})/i);
  if (chapMatch) {
    meta.chapter = chapMatch[1];
  }

  // 5. Item: match "Item 19", "Item 5"
  const itemMatch = text.match(/\b(?:Item|Itens)\s+(\d+|\b[a-zA-Z]\b)/i);
  if (itemMatch) {
    meta.item = itemMatch[1];
  }

  return meta;
}

/**
 * Compares two article strings numerically first, falling back to lexicographical comparison.
 */
export function compareArticles(aStr?: string, bStr?: string): number {
  if (!aStr && !bStr) return 0;
  if (!aStr) return 1; // place chunks without article at the end
  if (!bStr) return -1;

  // Extract numeric part
  const aNum = parseInt(aStr.replace(/\D/g, ""), 10);
  const bNum = parseInt(bStr.replace(/\D/g, ""), 10);

  if (!isNaN(aNum) && !isNaN(bNum)) {
    if (aNum !== bNum) {
      return aNum - bNum;
    }
  }

  return aStr.localeCompare(bStr, undefined, { numeric: true, sensitivity: "base" });
}

export class ContextBuilderService {
  /**
   * Helper to format a single chunk using a clean, structured uppercase layout.
   */
  static formatChunk(chunk: ContextChunkInput): string {
    const parts: string[] = [];
    parts.push("DOCUMENT");
    parts.push(chunk.documentName || "Desconhecido");

    if (chunk.chapter) {
      parts.push("CHAPTER");
      parts.push(chunk.chapter);
    }
    if (chunk.section) {
      parts.push("SECTION");
      parts.push(chunk.section);
    }
    if (chunk.article) {
      parts.push("ARTICLE");
      parts.push(chunk.article);
    }
    if (chunk.paragraph) {
      parts.push("PARAGRAPH");
      parts.push(chunk.paragraph);
    }
    if (chunk.item) {
      parts.push("ITEM");
      parts.push(chunk.item);
    }
    if (chunk.page) {
      parts.push("PAGE");
      parts.push(String(chunk.page));
    }

    parts.push("TEXT");
    parts.push(chunk.text);

    return parts.join("\n\n");
  }

  /**
   * Helper to build a candidate context string by joining formatted chunks.
   */
  static joinFormattedChunks(chunks: ContextChunkInput[]): string {
    if (chunks.length === 0) return "";
    const formatted = chunks.map(c => this.formatChunk(c));
    return "================================================\n\n" + formatted.join("\n\n================================================\n\n") + "\n\n================================================";
  }

  /**
   * Build structured, balanced context with detail outputs.
   */
  static buildContextDetailed(
    chunks: ContextChunkInput[],
    maxContextSize: number = env.DEFAULT_MAX_CONTEXT_SIZE
  ): DetailedContextResult {
    if (!chunks || chunks.length === 0) {
      return { context: "", selectedChunks: [] };
    }

    // 1. Eliminate duplicates by lowercased, trimmed text content
    const uniqueChunks: ContextChunkInput[] = [];
    const seenTexts = new Set<string>();

    for (const chunk of chunks) {
      const normalizedText = (chunk?.text ?? "").trim().toLowerCase();
      if (!seenTexts.has(normalizedText)) {
        seenTexts.add(normalizedText);
        uniqueChunks.push(chunk);
      }
    }

    // 2. Enrich metadata from parsed JSON or regex fallbacks
    const enrichedChunks: ContextChunkInput[] = uniqueChunks.map(chunk => {
      const textVal = chunk.text ?? "";
      const regexMeta = extractMetadataFromText(textVal);

      const parsedDocName = chunk.metadata?.sourceDocument || chunk.documentName || "";
      const cleanedDocName = parsedDocName ? parsedDocName.replace(/\.[^/.]+$/, "") : "";

      const resolvedPage = chunk.metadata?.pageNumber !== undefined ? chunk.metadata.pageNumber : chunk.page;

      return {
        ...chunk,
        documentName: cleanedDocName || chunk.documentName || "Desconhecido",
        article: chunk.article || regexMeta.article,
        paragraph: chunk.paragraph || regexMeta.paragraph,
        section: chunk.section || regexMeta.section,
        chapter: chunk.chapter || regexMeta.chapter,
        item: chunk.item || regexMeta.item,
        page: resolvedPage,
      };
    });

    // 3. Group chunks by documentId
    const docGroups: Record<string, ContextChunkInput[]> = {};
    for (const chunk of enrichedChunks) {
      const docId = chunk.documentId;
      if (!docGroups[docId]) {
        docGroups[docId] = [];
      }
      docGroups[docId].push(chunk);
    }

    // 4. Sort each group internally by article -> chunkIndex
    for (const docId of Object.keys(docGroups)) {
      docGroups[docId].sort((a, b) => {
        const artComp = compareArticles(a.article, b.article);
        if (artComp !== 0) {
          return artComp;
        }
        return a.chunkIndex - b.chunkIndex;
      });
    }

    // Sort documents alphabetically by name
    const docIds = Object.keys(docGroups).sort((a, b) => {
      const nameA = docGroups[a][0]?.documentName || "";
      const nameB = docGroups[b][0]?.documentName || "";
      return nameA.localeCompare(nameB);
    });

    // 5. Balanced round-robin selection
    const indices: Record<string, number> = {};
    for (const docId of docIds) {
      indices[docId] = 0;
    }

    const selectedChunks: ContextChunkInput[] = [];
    let hasMore = true;

    while (hasMore) {
      hasMore = false;
      for (const docId of docIds) {
        const group = docGroups[docId];
        const idx = indices[docId];
        if (idx < group.length) {
          const chunk = group[idx];

          // Test candidate context with this chunk added
          const tempSelected = [...selectedChunks, chunk];

          // To maintain proper grouping, group the tempSelected chunks by document first
          const tempGroupedSelected: Record<string, ContextChunkInput[]> = {};
          for (const s of tempSelected) {
            if (!tempGroupedSelected[s.documentId]) {
              tempGroupedSelected[s.documentId] = [];
            }
            tempGroupedSelected[s.documentId].push(s);
          }

          // Build ordered list of candidate chunks
          const candidateChunks: ContextChunkInput[] = [];
          for (const dId of docIds) {
            if (tempGroupedSelected[dId]) {
              candidateChunks.push(...tempGroupedSelected[dId]);
            }
          }

          const candidateContext = this.joinFormattedChunks(candidateChunks);
          if (candidateContext.length <= maxContextSize) {
            selectedChunks.push(chunk);
            indices[docId] = idx + 1;
            hasMore = true;
          } else {
            // Keep index advancing so we do not freeze, but do not add the chunk that overflows
            indices[docId] = idx + 1;
            hasMore = true;
          }
        }
      }
    }

    // 6. Group the final selected chunks by document
    const finalGroupedSelected: Record<string, ContextChunkInput[]> = {};
    for (const s of selectedChunks) {
      if (!finalGroupedSelected[s.documentId]) {
        finalGroupedSelected[s.documentId] = [];
      }
      finalGroupedSelected[s.documentId].push(s);
    }

    const finalOrderedChunks: ContextChunkInput[] = [];
    for (const dId of docIds) {
      if (finalGroupedSelected[dId]) {
        finalOrderedChunks.push(...finalGroupedSelected[dId]);
      }
    }

    const context = this.joinFormattedChunks(finalOrderedChunks);

    // 7. Structured Debug Logs Only (omits chunk text)
    const totalChunksBefore = chunks.length;
    const discardedCount = totalChunksBefore - finalOrderedChunks.length;
    const documentsSelected = Array.from(new Set(chunks.map(c => c.documentName || "Desconhecido")));
    const documentsIncluded = Array.from(new Set(finalOrderedChunks.map(c => c.documentName || "Desconhecido")));

    logger.info("[DEBUG] [CONTEXT_BUILDER] Detalhes do Contexto Construído:", {
      documentsSelected,
      chunksSelected: finalOrderedChunks.length,
      chunksDiscarded: discardedCount,
      discardReason: discardedCount > 0 ? "Excesso do limite de caracteres do contexto (maxContextSize)" : "Nenhum chunk descartado",
      finalContextSize: context.length,
      documentsIncluded
    });

    return {
      context,
      selectedChunks: finalOrderedChunks,
    };
  }

  /**
   * Builds a clean, structured context from retrieved chunks.
   * Maintains full backward compatibility.
   */
  static buildContext(
    chunks: ContextChunkInput[],
    maxContextSize: number = env.DEFAULT_MAX_CONTEXT_SIZE
  ): string {
    const result = this.buildContextDetailed(chunks, maxContextSize);
    return result.context;
  }
}
