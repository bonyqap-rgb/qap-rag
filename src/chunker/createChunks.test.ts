import { test } from "node:test";
import assert from "node:assert";
import { createChunks } from "./createChunks.js";

test("createChunks splits text into correct sizes", () => {
  const text = "a".repeat(2500);
  const chunks = createChunks(text, 1000, 200);

  // Expected chunk count:
  // Chunk 1: 0 to 1000
  // Chunk 2: 800 to 1800 (800 + 1000)
  // Chunk 3: 1600 to 2500 (1600 + 1000)
  // Chunk 4: 2400 to 2500 (2400 + 1000, capped at 2500)
  assert.strictEqual(chunks.length, 4);
  assert.strictEqual(chunks[0].length, 1000);
  assert.strictEqual(chunks[1].length, 1000);
  assert.strictEqual(chunks[2].length, 900);
  assert.strictEqual(chunks[3].length, 100);
});

test("createChunks handles text smaller than chunkSize", () => {
  const text = "Short text sample";
  const chunks = createChunks(text, 100, 10);

  assert.strictEqual(chunks.length, 1);
  assert.strictEqual(chunks[0], "Short text sample");
});

test("createChunks handles empty text", () => {
  const chunks = createChunks("", 100, 10);
  assert.strictEqual(chunks.length, 0);
});
