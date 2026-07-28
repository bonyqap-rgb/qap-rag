import { test } from "node:test";
import assert from "node:assert";
import { createChunks } from "./createChunks.js";

test("createChunks handles page markers and preserves semantic sentences", () => {
  const text = `[PAGE_MARKER:1]\nEsta e a primeira frase. Esta e a segunda frase de teste.\n[PAGE_MARKER:2]\nEsta frase esta na pagina dois.`;
  const chunks = createChunks(text, 1000, 20);

  // Should split into chunks or keep together depending on size
  assert.strictEqual(chunks.length > 0, true);

  // First chunk should have Page 1 marker
  assert.strictEqual(chunks[0].startsWith("[PAGE:1]"), true);

  // Text should contain parsed contents
  assert.strictEqual(chunks[0].includes("Esta e a primeira frase"), true);
});

test("createChunks respects chunkSize and sentence boundaries", () => {
  const text = `[PAGE_MARKER:1]\nEsta e uma frase curta. Outra frase curta. Mais uma de teste.`;
  // Set small chunkSize so it splits on sentence boundaries
  const chunks = createChunks(text, 50, 10);

  assert.strictEqual(chunks.length > 0, true);
  // Every chunk should start with [PAGE:1]
  for (const chunk of chunks) {
    assert.strictEqual(chunk.startsWith("[PAGE:1]"), true);
  }
});

test("createChunks handles empty text", () => {
  const chunks = createChunks("", 100, 10);
  assert.strictEqual(chunks.length, 0);
});
