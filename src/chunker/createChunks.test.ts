import { test } from "node:test";
import assert from "node:assert";
import { createChunks } from "./createChunks.js";

test("createChunks handles page markers and preserves semantic sentences", () => {
  const text = `[PAGE_MARKER:1]\nEsta e a primeira frase. Esta e a segunda frase de teste.\n[PAGE_MARKER:2]\nEsta frase esta na pagina dois.`;
  const chunks = createChunks(text, 1000, 20);

  assert.strictEqual(chunks.length > 0, true);
  assert.strictEqual(chunks[0].startsWith("[PAGE:1]"), true);
  assert.strictEqual(chunks[0].includes("Esta e a primeira frase"), true);
});

test("createChunks respects chunkSize and sentence boundaries", () => {
  const text = `[PAGE_MARKER:1]\nEsta e uma frase curta. Outra frase curta. Mais uma de teste.`;
  const chunks = createChunks(text, 50, 10);

  assert.strictEqual(chunks.length > 0, true);
  for (const chunk of chunks) {
    assert.strictEqual(chunk.startsWith("[PAGE:1]"), true);
  }
});

test("createChunks keeps inline legal articles in separate chunks", () => {
  const text = `[PAGE_MARKER:5]\nInfrações disciplinares Art. 19. Este Código não compreende as infrações dos regulamentos disciplinares. Crimes praticados em tempo de guerra Art. 20. Aos crimes praticados em tempo de guerra aplicam-se as penas do tempo de paz. Pessoa considerada militar Art. 22. É militar para o efeito da aplicação deste Código. Equiparação a comandante Art. 23. Equipara-se ao comandante, para o efeito da aplicação da lei penal militar, toda autoridade com função de direção.`;
  const chunks = createChunks(text, 1000, 200);

  const article19 = chunks.find((chunk) => /Art\. 19\./.test(chunk));
  const article20 = chunks.find((chunk) => /Art\. 20\./.test(chunk));
  const article22 = chunks.find((chunk) => /Art\. 22\./.test(chunk));
  const article23 = chunks.find((chunk) => /Art\. 23\./.test(chunk));

  assert.ok(article19);
  assert.ok(article20);
  assert.ok(article22);
  assert.ok(article23);
  assert.strictEqual(article23.includes("Art. 22."), false);
  assert.strictEqual(article23.includes("Art. 20."), false);
  assert.strictEqual(article23.includes("Art. 19."), false);
  assert.match(article23, /Art\. 23\. Equipara-se ao comandante/);
});

test("createChunks handles empty text", () => {
  const chunks = createChunks("", 100, 10);
  assert.strictEqual(chunks.length, 0);
});
