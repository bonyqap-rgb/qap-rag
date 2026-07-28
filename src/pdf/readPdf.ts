import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

/**
 * Reads a PDF document from a binary buffer and extracts its textual content page-by-page.
 * Automatically normalizes consecutive spaces and trims page text.
 *
 * @param buffer - The PDF file buffer
 * @returns The complete extracted and sanitized text string from the PDF
 */
export async function readPdf(buffer: Buffer): Promise<string> {
  const pdf = await pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
  }).promise;

  let text = "";

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();

    // Extract text items and join them with a single space
    const pageText = content.items
      .map((item: any) => item.str)
      .join(" ");

    // Normalize consecutive white spaces/tabs/newlines and append page text
    const sanitizedPageText = pageText.replace(/\s+/g, " ").trim();
    if (sanitizedPageText.length > 0) {
      text += sanitizedPageText + "\n";
    }
  }

  return text.trim();
}
