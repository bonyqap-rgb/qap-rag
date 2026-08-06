import { test } from "node:test";
import assert from "node:assert";
import { inspectDocument } from "./inspect-rag.js";

test("inspect-rag - successfully inspects CPM mock document", async () => {
  const result = await inspectDocument("Código Penal Militar");
  assert.ok(result);
  assert.strictEqual(result.documentName, "codigo_penal_militar.pdf");
  assert.strictEqual(result.totalChunks, 100);
  assert.strictEqual(result.totalPages, 12);
  assert.strictEqual(result.extractedChars, 120000);

  // Check search terms for CPM
  const desercaoRes = result.searchResults.find(r => r.term === "deserção");
  assert.ok(desercaoRes);
  assert.strictEqual(desercaoRes.found, true);
  assert.strictEqual(desercaoRes.page, 5);
  assert.strictEqual(desercaoRes.chunkId, "chunk-cpm-2");

  const insubordinacaoRes = result.searchResults.find(r => r.term === "insubordinação");
  assert.ok(insubordinacaoRes);
  assert.strictEqual(insubordinacaoRes.found, false);
});

test("inspect-rag - successfully inspects RDPM mock document", async () => {
  const result = await inspectDocument("RDPM");
  assert.ok(result);
  assert.strictEqual(result.documentName, "regulamento_disciplinar_rdpm.pdf");
  assert.strictEqual(result.totalChunks, 50);
  assert.strictEqual(result.totalPages, 14);
  assert.strictEqual(result.extractedChars, 60000);

  // Check search terms for RDPM
  const sindicanciaRes = result.searchResults.find(r => r.term === "sindicância");
  assert.ok(sindicanciaRes);
  assert.strictEqual(sindicanciaRes.found, true);
  assert.strictEqual(sindicanciaRes.page, 14);

  const transgressaoRes = result.searchResults.find(r => r.term === "transgressão disciplinar");
  assert.ok(transgressaoRes);
  assert.strictEqual(transgressaoRes.found, true);
  assert.strictEqual(transgressaoRes.page, 8);
});

test("inspect-rag - returns null for non-existing document", async () => {
  const result = await inspectDocument("Inexistente");
  assert.strictEqual(result, null);
});
