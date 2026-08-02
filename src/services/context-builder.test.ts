process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy_key";
process.env.GROQ_API_KEY = "dummy_key";
import { test } from "node:test";
import assert from "node:assert";
import {
  ContextBuilderService,
  extractMetadataFromText,
  compareArticles,
  ContextChunkInput
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
  for (let i = 0; i < 10; i++) {
    chunks.push({
      documentId: "doc-A",
      chunkIndex: i,
      text: `Artigo ${i + 1}: Texto longo número ${i + 1} para preencher o espaço do documento A.`,
      metadata: { sourceDocument: "DocA.pdf" }
    });
  }

  // Doc B
  for (let i = 0; i < 2; i++) {
    chunks.push({
      documentId: "doc-B",
      chunkIndex: i,
      text: `Item ${i + 1}: Diretriz número ${i + 1} para preencher o espaço do documento B.`,
      metadata: { sourceDocument: "DocB.pdf" }
    });
  }

  // Using a maxContextSize that fits about 4 chunks.
  // With round robin, we should get 2 chunks from Doc A and 2 chunks from Doc B,
  // instead of 4 chunks from Doc A and 0 from Doc B!
  const result = ContextBuilderService.buildContextDetailed(chunks, 850);

  const docACount = result.selectedChunks.filter(c => c.documentId === "doc-A").length;
  const docBCount = result.selectedChunks.filter(c => c.documentId === "doc-B").length;

  // Assert both documents got a fair share of chunks instead of Doc A hogging all space
  assert.strictEqual(docBCount, 2); // Doc B is fully represented
  assert.ok(docACount >= 2); // Doc A also got represented
});
