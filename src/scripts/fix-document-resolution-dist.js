import fs from "node:fs";

const files = [
  "dist/services/chat.service.js",
  "dist/services/search.service.js",
];

for (const file of files) {
  if (!fs.existsSync(file)) continue;

  let source = fs.readFileSync(file, "utf8");

  // Never reintroduce the generic filename alias "penal".
  source = source.replace(/\n\s*["']penal["'],?/g, "");

  // Remove legacy single-word filename alias loops if they exist in generated JS.
  const singleWordAliasBlock = /\n\s*\/\/ Also add any word in the filename[\s\S]*?\n\s*}\n\n\s*return Array\.from\(aliases\)/;
  if (singleWordAliasBlock.test(source)) {
    source = source.replace(singleWordAliasBlock, "\n\n  return Array.from(aliases)");
  }

  const searchSingleWordAliasBlock = /\n\s*for \(const part of parts\) \{\n\s*if \(part\.length >= 3 && !FORBIDDEN_GENERIC_WORDS\.has\(part\)\) \{\n\s*aliases\.add\(part\);\n\s*}\n\s*}/;
  if (searchSingleWordAliasBlock.test(source)) {
    source = source.replace(searchSingleWordAliasBlock, "");
  }

  fs.writeFileSync(file, source);
  console.log(`[fix-document-resolution-dist] Processado: ${file}`);
}
