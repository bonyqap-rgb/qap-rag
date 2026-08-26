import fs from "node:fs";

const files = [
  "src/services/chat.service.ts",
  "src/services/search.service.ts",
];

for (const file of files) {
  let source = fs.readFileSync(file, "utf8");

  if (!source.includes('"penal"')) {
    const marker = '  "policiais",';
    if (!source.includes(marker)) {
      throw new Error(`Marcador de palavras genéricas não encontrado em ${file}`);
    }
    source = source.replace(marker, `${marker}\n  "penal",`);
    fs.writeFileSync(file, source);
    console.log(`[fix-document-resolution] Corrigido: ${file}`);
  } else {
    console.log(`[fix-document-resolution] Já corrigido: ${file}`);
  }
}
