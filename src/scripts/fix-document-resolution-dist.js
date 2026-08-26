import fs from "node:fs";

const files = [
  "dist/services/chat.service.js",
  "dist/services/search.service.js",
];

for (const file of files) {
  if (!fs.existsSync(file)) continue;

  let source = fs.readFileSync(file, "utf8");

  if (!source.includes('"penal"')) {
    const marker = '"policiais",';
    if (!source.includes(marker)) {
      throw new Error(`Marcador de palavras genéricas não encontrado em ${file}`);
    }
    source = source.replace(marker, `${marker}\n    "penal",`);
    fs.writeFileSync(file, source);
    console.log(`[fix-document-resolution-dist] Corrigido: ${file}`);
  } else {
    console.log(`[fix-document-resolution-dist] Já corrigido: ${file}`);
  }
}
