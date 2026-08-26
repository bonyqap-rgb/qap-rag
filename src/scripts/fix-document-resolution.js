import fs from "node:fs";

const files = [
  "src/services/chat.service.ts",
  "src/services/search.service.ts",
];

for (const file of files) {
  let source = fs.readFileSync(file, "utf8");

  // Remove penal from the generic-word whitelist if an older build added it.
  if (source.includes('  "penal",')) {
    source = source.replace(/\n\s*"penal",/g, "");
  }

  // Never create document aliases from individual filename words.
  // Example: Codigo_penal_6ed.pdf must NOT create the alias "penal".
  const chatSingleWordAliasBlock = /\n\s*\/\/ Also add any word in the filename[\s\S]*?\n\s*}\n\n\s*return Array\.from\(aliases\)/;
  if (chatSingleWordAliasBlock.test(source)) {
    source = source.replace(chatSingleWordAliasBlock, "\n\n  return Array.from(aliases)");
  }

  const searchSingleWordAliasBlock = /\n\s*for \(const part of parts\) \{\n\s*if \(part\.length >= 3 && !FORBIDDEN_GENERIC_WORDS\.has\(part\)\) \{\n\s*aliases\.add\(part\);\n\s*}\n\s*}/;
  if (searchSingleWordAliasBlock.test(source)) {
    source = source.replace(searchSingleWordAliasBlock, "");
  }

  // A document restriction is authoritative. Do not escape it with a global search.
  const fallbackBlock = /\n\s*\/\/ 4\. Fallback obrigatório:[\s\S]*?\n\s*}\n\s*}\n\s*catch \(error: any\)/;
  if (fallbackBlock.test(source)) {
    source = source.replace(
      fallbackBlock,
      `\n      // Document restriction is authoritative; global fallback disabled.\n    }\n    catch (error: any)`
    );
  }

  fs.writeFileSync(file, source);
  console.log(`[fix-document-resolution] Processado: ${file}`);
}
