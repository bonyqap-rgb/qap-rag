import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

export async function readPdf(buffer: Buffer): Promise<string> {
  const pdf = await pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
  }).promise;

  let text = "";

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items
      .map((item: any) => item.str)
      .join(" ");
    text += "\n";
  }

  return text;
}