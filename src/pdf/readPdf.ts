import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

/**
 * Extracts and normalizes text from a PDF buffer page-by-page.
 * Appends standard page markers to preserve document page structures.
 * Removes non-printable, control, and corrupted characters while normalizing spaces.
 *
 * @param buffer - The PDF file buffer
 * @returns The fully extracted and normalized document text string with page markers
 */
async function defaultReadPdf(buffer: Buffer): Promise<string> {
  const pdf = await pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
  }).promise;

  let text = "";

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();

    // Joint strings with space
    const pageRaw = content.items
      .map((item: any) => item.str)
      .join(" ");

    // Remove control/non-printable characters, preserve carriage returns and standard punctuation
    let normalized = pageRaw
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, "") // non-printable ascii
      .replace(/\s+/g, " ") // duplicate whitespace collapse
      .trim();

    if (normalized.length > 0) {
      // Embed page marker for the semantic chunker to parse and extract metadata
      text += `[PAGE_MARKER:${i}]\n${normalized}\n\n`;
    }
  }

  return text.trim();
}

let readPdfImplementation = defaultReadPdf;

export function setReadPdfImplementation(fn: typeof defaultReadPdf) {
  readPdfImplementation = fn;
}

export function resetReadPdfImplementation() {
  readPdfImplementation = defaultReadPdf;
}

export async function readPdf(buffer: Buffer): Promise<string> {
  return readPdfImplementation(buffer);
}
