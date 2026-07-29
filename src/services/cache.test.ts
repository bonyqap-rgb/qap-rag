import { test } from "node:test";
import assert from "node:assert";
import { MemoryCacheProvider, generateHashKey } from "./cache.service.js";

test("MemoryCacheProvider - stores and retrieves value within TTL", async () => {
  const cache = new MemoryCacheProvider<number[]>(1, 10); // TTL 1s
  const key = generateHashKey("teste de cache");
  const value = [1, 2, 3];

  cache.set(key, value);

  const retrieved = cache.get(key);
  assert.deepStrictEqual(retrieved, value);
});

test("MemoryCacheProvider - returns null after TTL expires", async () => {
  const cache = new MemoryCacheProvider<number[]>(0.1, 10); // TTL 100ms
  const key = generateHashKey("teste de cache com expiracao");
  const value = [1, 2, 3];

  cache.set(key, value);

  // Wait 150ms
  await new Promise((resolve) => setTimeout(resolve, 150));

  const retrieved = cache.get(key);
  assert.strictEqual(retrieved, null);
});

test("MemoryCacheProvider - respects maxSize constraint", async () => {
  const cache = new MemoryCacheProvider<number[]>(10, 2); // max 2 elements
  cache.set("key1", [1]);
  cache.set("key2", [2]);
  cache.set("key3", [3]); // triggers eviction of oldest (key1)

  assert.strictEqual(cache.get("key1"), null);
  assert.deepStrictEqual(cache.get("key2"), [2]);
  assert.deepStrictEqual(cache.get("key3"), [3]);
});

test("generateHashKey - returns consistent and unique SHA-256 hex keys", () => {
  const key1 = generateHashKey(" texto para testar ");
  const key2 = generateHashKey("texto para testar");
  const key3 = generateHashKey("outro texto");

  assert.strictEqual(key1, key2); // normalized text should match
  assert.notStrictEqual(key1, key3);
  assert.strictEqual(key1.length, 64); // SHA-256 standard length
});
