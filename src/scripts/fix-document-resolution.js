import fs from "node:fs";

const files = [
  "src/services/chat.service.ts",
  "src/services/search.service.ts",
];

for (const file of files) {
  let source = fs.readFileSync(file, "utf8");

  if (source.includes('  "penal",')) {
    source = source.replace(/\n\s*"penal",/g, "");
  }

  const chatSingleWordAliasBlock = /\n\s*\/\/ Also add any word in the filename[\s\S]*?\n\s*}\n\n\s*return Array\.from\(aliases\)/;
  if (chatSingleWordAliasBlock.test(source)) {
    source = source.replace(chatSingleWordAliasBlock, "\n\n  return Array.from(aliases)");
  }

  const searchSingleWordAliasBlock = /\n\s*for \(const part of parts\) \{\n\s*if \(part\.length >= 3 && !FORBIDDEN_GENERIC_WORDS\.has\(part\)\) \{\n\s*aliases\.add\(part\);\n\s*}\n\s*}/;
  if (searchSingleWordAliasBlock.test(source)) {
    source = source.replace(searchSingleWordAliasBlock, "");
  }

  const fallbackBlock = /\n\s*\/\/ 4\. Fallback obrigatório:[\s\S]*?\n\s*}\n\s*}\n\s*catch \(error: any\)/;
  if (fallbackBlock.test(source)) {
    source = source.replace(
      fallbackBlock,
      `\n      // Document restriction is authoritative; global fallback disabled.\n    }\n    catch (error: any)`
    );
  }

  // Literal Article Extraction v2: isolate the requested article before building the answer.
  if (file === "src/services/chat.service.ts" && !source.includes("Literal Article Extraction v2")) {
    const literalBlock = /\n    \/\/ Direct Article Transcription Bypass \(No LLM generation for literal requests\)[\s\S]*?\n    const systemPrompt =/;
    if (literalBlock.test(source)) {
      const replacement = `
    // Literal Article Extraction v2: isolate the requested article before building the answer.
    if (isLiteralArticleRequest(question)) {
      const articleMatch = normalizeText(question).match(/\\bart(?:igo)?s?\\.?\\s*(?:n[ºo°]?\\.?\\s*)?(\\d{1,4})/i);
      const requestedArticle = articleMatch?.[1] ?? null;
      if (requestedArticle) {
        const exactResults = searchResults
          .map((r: any) => {
            const text = String(r?.text ?? "");
            const headers = Array.from(text.matchAll(/(?:^|\\b)(?:Art(?:igo)?\\.?)\\s*(\\d{1,4})(?:\\s*[º°o]|\\s*\\.|\\s*|\\b)/gi));
            const target = headers.findIndex((m: any) => String(m[1]) === requestedArticle);
            if (target < 0) return null;
            const start = (headers[target] as any).index + String((headers[target] as any)[0]).search(/\\bArt/i);
            const end = target + 1 < headers.length ? (headers[target + 1] as any).index + String((headers[target + 1] as any)[0]).search(/\\bArt/i) : text.length;
            const exactText = text.slice(start, end).trim();
            return exactText ? { ...r, text: exactText } : null;
          })
          .filter(Boolean);

        const seen = new Set<string>();
        const isolatedResults = exactResults.filter((r: any) => {
          const key = String(r.text).trim();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        if (isolatedResults.length > 0) {
          const responseText = isolatedResults.map((r: any) => String(r.text).trim()).join("\\n\\n");
          const sources: ChatSource[] = isolatedResults.map((c: any) => ({
            documentId: c.documentId,
            filename: docMap.get(c.documentId) || c.documentName || "Desconhecido",
            chunkIndex: c.chunkIndex,
            score: c.score !== undefined ? parseFloat(c.score.toFixed(4)) : 0,
          }));
          const overallDuration = performance.now() - overallStartTime;
          return {
            answer: responseText,
            sources,
            metadata: {
              searchTime: \`\${searchTimeMs.toFixed(0)}ms\`,
              generationTime: "0ms",
              totalTime: \`\${overallDuration.toFixed(0)}ms\`,
            },
          };
        }
      }
    }

    const systemPrompt =`;
      source = source.replace(literalBlock, replacement);
    }
  }

  fs.writeFileSync(file, source);
  console.log(`[fix-document-resolution] Processado: ${file}`);
}
