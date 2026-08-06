process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy_key";
process.env.GROQ_API_KEY = "dummy_key";
import { test } from "node:test";
import assert from "node:assert";
import {
  ContextBuilderService,
  extractMetadataFromText,
  compareArticles,
  ContextChunkInput,
  computeJaccardSimilarity
} from "./context-builder.service.js";

test("extractMetadataFromText - parses Portuguese legal/military indicators", () => {
  const sample1 = "De acordo com o Artigo 31, parágrafo único, inciso I, da RDPM...";
  const meta1 = extractMetadataFromText(sample1);
  assert.strictEqual(meta1.article, "31");
  assert.strictEqual(meta1.paragraph, "único");

  const sample2 = "Conforme o Art. 12-B, § 2º, Seção II, Capítulo IV do regulamento militar...";
  const meta2 = extractMetadataFromText(sample2);
  assert.strictEqual(meta2.article, "12-B");
  assert.strictEqual(meta2.paragraph, "§ 2º");
  assert.strictEqual(meta2.section, "II");
  assert.strictEqual(meta2.chapter, "IV");

  const sample3 = "No Item 19 consta a diretriz sobre policiamento...";
  const meta3 = extractMetadataFromText(sample3);
  assert.strictEqual(meta3.item, "19");
});

test("compareArticles - sorts article strings numerically and lexicographically", () => {
  assert.strictEqual(compareArticles("5", "10") < 0, true);
  assert.strictEqual(compareArticles("12", "12") === 0, true);
  assert.strictEqual(compareArticles("31", "5") > 0, true);
  assert.strictEqual(compareArticles("Artigo 12-A", "Artigo 12-B") < 0, true);
  assert.strictEqual(compareArticles("31-A", "31") > 0, true);
  assert.strictEqual(compareArticles(undefined, "5") > 0, true); // placing undefined at the end
});

test("ContextBuilderService.buildContextDetailed - removes duplicates, groups by document, sorts and balances", () => {
  const chunks: ContextChunkInput[] = [
    {
      documentId: "doc-A",
      chunkIndex: 1,
      text: "Artigo 31: O militar deve agir com competência.",
      metadata: { sourceDocument: "RDPM.pdf" }
    },
    {
      documentId: "doc-A",
      chunkIndex: 0,
      text: "Artigo 5: Este é o início do regulamento.",
      metadata: { sourceDocument: "RDPM.pdf" }
    },
    // Duplicate of doc-A's Article 31
    {
      documentId: "doc-A",
      chunkIndex: 2,
      text: "Artigo 31: O militar deve agir com competência.  ",
      metadata: { sourceDocument: "RDPM.pdf" }
    },
    {
      documentId: "doc-B",
      chunkIndex: 0,
      text: "Conforme Item 19 das instruções do Comandante-Geral.",
      metadata: { sourceDocument: "I-36-PM.pdf" }
    }
  ];

  const result = ContextBuilderService.buildContextDetailed(chunks, 4000);

  // Assert duplicates are removed: we should have 3 selected chunks (Artigo 5, Artigo 31, and Item 19)
  assert.strictEqual(result.selectedChunks.length, 3);

  // Assert document grouping is preserved and ordered alphabetically by doc name (I-36-PM before RDPM)
  const firstDocId = result.selectedChunks[0].documentId;
  const secondDocId = result.selectedChunks[1].documentId;
  const thirdDocId = result.selectedChunks[2].documentId;

  // I-36-PM (doc-B) should be grouped together and come before RDPM (doc-A)
  assert.strictEqual(firstDocId, "doc-B");
  assert.strictEqual(secondDocId, "doc-A");
  assert.strictEqual(thirdDocId, "doc-A");

  // Inside doc-A, chunk index 0 (Artigo 5) should come before chunk index 1 (Artigo 31) because 5 < 31
  assert.strictEqual(result.selectedChunks[1].chunkIndex, 0); // Artigo 5
  assert.strictEqual(result.selectedChunks[2].chunkIndex, 1); // Artigo 31

  // Assert structured context layout is generated
  const context = result.context;
  assert.ok(context.includes("================================================"));
  assert.ok(context.includes("DOCUMENT\n\nI-36-PM"));
  assert.ok(context.includes("ITEM\n\n19"));
  assert.ok(context.includes("DOCUMENT\n\nRDPM"));
  assert.ok(context.includes("ARTICLE\n\n5"));
  assert.ok(context.includes("ARTICLE\n\n31"));
});

test("ContextBuilderService.buildContextDetailed - performs balanced proportional round-robin selection", () => {
  // Scenario: We have Doc A with 10 chunks, and Doc B with 2 chunks.
  // We set a small maxContextSize to verify round robin balancing.
  const chunks: ContextChunkInput[] = [];

  // Doc A
  const docATexts = [
    "Artigo 1: Normas fundamentais sobre hierarquia e disciplina no serviço militar estadual e policiamento.",
    "Artigo 2: O oficial deve manter postura digna de seu cargo perante os subordinados e a sociedade civil.",
    "Artigo 3: Os praças possuem deveres específicos no cumprimento das escalas de plantão ordinário e extraordinário.",
    "Artigo 4: As infrações disciplinares classificam-se em graves, médias e leves, a critério da autoridade delegada.",
    "Artigo 5: O processo administrativo disciplinar militar assegura ampla defesa e o contraditório ao acusado.",
    "Artigo 6: Das decisões proferidas cabe recurso hierárquico no prazo legal estabelecido em portaria específica.",
    "Artigo 7: A reabilitação do militar punido ocorre após preenchidos os requisitos temporais e de bom comportamento.",
    "Artigo 8: O porte de arma em serviço é obrigatório para todos os integrantes ativos da corporação operacional.",
    "Artigo 9: Ficam dispensados das atividades físicas regulamentares os servidores que apresentarem laudo médico válido.",
    "Artigo 10: Casos omissos neste regulamento de conduta serão resolvidos pelo colegiado superior da Polícia Militar."
  ];
  for (let i = 0; i < docATexts.length; i++) {
    chunks.push({
      documentId: "doc-A",
      chunkIndex: i,
      text: docATexts[i],
      metadata: { sourceDocument: "DocA.pdf" }
    });
  }

  // Doc B
  const docBTexts = [
    "Item 1: Diretrizes de policiamento preventivo nas áreas com maior índice de criminalidade urbana local.",
    "Item 2: Escala de serviço das guarnições para o feriado prolongado com foco em atendimento ao cidadão."
  ];
  for (let i = 0; i < docBTexts.length; i++) {
    chunks.push({
      documentId: "doc-B",
      chunkIndex: i,
      text: docBTexts[i],
      metadata: { sourceDocument: "DocB.pdf" }
    });
  }

  // Using a maxContextSize that fits about 4 chunks.
  // With round robin, we should get 2 chunks from Doc A and 2 chunks from Doc B,
  // instead of 4 chunks from Doc A and 0 from Doc B!
  const result = ContextBuilderService.buildContextDetailed(chunks, 850);

  const docACount = result.selectedChunks.filter(c => c.documentId === "doc-A").length;
  const docBCount = result.selectedChunks.filter(c => c.documentId === "doc-B").length;

  // Assert both documents got a fair share of chunks.
  // Note: Doc B's two chunks are consecutive and got merged into 1 chunk successfully!
  assert.strictEqual(docBCount, 1); // Doc B is fully represented as 1 merged chunk
  assert.ok(docACount >= 2); // Doc A also got represented

  // Verify text of the merged chunk contains both items
  const docBChunk = result.selectedChunks.find(c => c.documentId === "doc-B")!;
  assert.ok(docBChunk.text.includes("Item 1") && docBChunk.text.includes("Item 2"));
});

test("ContextBuilderService.computeJaccardSimilarity - ignores prepositions/stop words and measures precise overlap", () => {
  const t1 = "O prazo para recurso administrativo no rito sumário.";
  const t2 = "Qual o prazo do recurso de rito sumário do militar?";

  const sim = computeJaccardSimilarity(t1, t2);
  // Common terms: "prazo", "recurso", "rito", "sumario"
  // Stop words: "o", "para", "no", "qual", "do", "de", "militar"? "militar" is not a stop word.
  assert.ok(sim > 0.5);

  // No overlap
  const simZero = computeJaccardSimilarity("Policiamento ostensivo preventivo.", "Processo disciplinar militar.");
  assert.strictEqual(simZero, 0);
});

test("ContextBuilderService - consecutive chunk merging for same articles", () => {
  const chunks: ContextChunkInput[] = [
    {
      documentId: "doc-A",
      chunkIndex: 0,
      text: "Parte A do artigo 42.",
      article: "42",
      metadata: { sourceDocument: "DocA.pdf" }
    },
    {
      documentId: "doc-A",
      chunkIndex: 1,
      text: "Parte B do artigo 42.",
      article: "42",
      metadata: { sourceDocument: "DocA.pdf" }
    },
    {
      documentId: "doc-A",
      chunkIndex: 2,
      text: "Diferente artigo 43.",
      article: "43",
      metadata: { sourceDocument: "DocA.pdf" }
    }
  ];

  const merged = ContextBuilderService.mergeConsecutiveChunks(chunks);
  assert.strictEqual(merged.length, 2);
  assert.ok(merged[0].text.includes("Parte A") && merged[0].text.includes("Parte B"));
  assert.strictEqual(merged[1].text, "Diferente artigo 43.");
});

test("ContextBuilderService - Controlled Diversity gap-based selection", () => {
  // Scenario 1: One dominant document (score gap > 0.25)
  const dominantChunks: ContextChunkInput[] = [
    {
      documentId: "doc-A",
      chunkIndex: 0,
      text: "Excelente trecho muito relevante.",
      score: 0.9,
      metadata: { sourceDocument: "DocA.pdf" }
    },
    {
      documentId: "doc-A",
      chunkIndex: 1,
      text: "Outro trecho também bastante útil do mesmo documento.",
      score: 0.85,
      metadata: { sourceDocument: "DocA.pdf" }
    },
    {
      documentId: "doc-B",
      chunkIndex: 0,
      text: "Trecho genérico de outro doc com baixa utilidade.",
      score: 0.4,
      metadata: { sourceDocument: "DocB.pdf" }
    }
  ];

  const resultDom = ContextBuilderService.buildContextDetailed(dominantChunks, 1000);
  // Gap is 0.9 - 0.4 = 0.5 (> 0.25). Should select strictly by score (Doc A chunks should come first, then Doc B)
  // In the output: since Doc A chunks are merged (they are consecutive 0 and 1, same doc, bothNoArticle is true),
  // they form 1 merged chunk. So selected chunks has Doc A (merged) and Doc B.
  const docAChunks = resultDom.selectedChunks.filter(c => c.documentId === "doc-A");
  assert.strictEqual(docAChunks.length, 1);
  assert.ok(docAChunks[0].text.includes("Excelente trecho") && docAChunks[0].text.includes("bastante útil"));
});
