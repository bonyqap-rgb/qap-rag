import { test } from "node:test";
import assert from "node:assert";
import { env } from "../config/env.js";
import { createEmbedding, resetEmbeddingImplementation } from "./embed.js";

test("Embedding Service - Voyage AI success and 1536 padding", async () => {
  // Store original environment variables
  const originalVoyageKey = env.VOYAGE_API_KEY;
  const originalNomicKey = env.NOMIC_API_KEY;
  const originalFetch = globalThis.fetch;

  env.VOYAGE_API_KEY = "mock_voyage_key";
  env.NOMIC_API_KEY = undefined;

  // Mock global fetch
  let calledUrl = "";
  let calledOptions: any = null;

  globalThis.fetch = async (url: any, options: any) => {
    calledUrl = url.toString();
    calledOptions = options;
    return {
      ok: true,
      json: async () => ({
        data: [
          {
            embedding: Array(1024).fill(0.5),
            index: 0
          }
        ]
      })
    } as any;
  };

  try {
    resetEmbeddingImplementation(); // Ensure real implementation is active
    const result = await createEmbedding("test embedding text");

    assert.strictEqual(calledUrl, "https://api.voyageai.com/v1/embeddings");
    assert.strictEqual(calledOptions?.method, "POST");
    const body = JSON.parse(calledOptions?.body);
    assert.deepStrictEqual(body.input, ["test embedding text"]);
    assert.strictEqual(body.model, "voyage-3");

    // Check padding logic (1024 mock dimensions + 512 zeros = 1536)
    assert.strictEqual(result.length, 1536);
    assert.strictEqual(result[0], 0.5);
    assert.strictEqual(result[1023], 0.5);
    assert.strictEqual(result[1024], 0);
    assert.strictEqual(result[1535], 0);
  } finally {
    // Restore
    env.VOYAGE_API_KEY = originalVoyageKey;
    env.NOMIC_API_KEY = originalNomicKey;
    globalThis.fetch = originalFetch;
  }
});

test("Embedding Service - Voyage AI success and 3072 truncation to 1536", async () => {
  const originalVoyageKey = env.VOYAGE_API_KEY;
  const originalNomicKey = env.NOMIC_API_KEY;
  const originalFetch = globalThis.fetch;

  env.VOYAGE_API_KEY = "mock_voyage_key";
  env.NOMIC_API_KEY = undefined;

  let calledUrl = "";
  let calledOptions: any = null;

  globalThis.fetch = async (url: any, options: any) => {
    calledUrl = url.toString();
    calledOptions = options;
    return {
      ok: true,
      json: async () => ({
        data: [
          {
            embedding: Array(3072).fill(0.9),
            index: 0
          }
        ]
      })
    } as any;
  };

  try {
    resetEmbeddingImplementation();
    const result = await createEmbedding("test truncation text");

    assert.strictEqual(calledUrl, "https://api.voyageai.com/v1/embeddings");
    assert.strictEqual(calledOptions?.method, "POST");
    const body = JSON.parse(calledOptions?.body);
    assert.deepStrictEqual(body.input, ["test truncation text"]);

    // Check truncation logic (3072 dimensions sliced to exactly 1536)
    assert.strictEqual(result.length, 1536);
    assert.strictEqual(result[0], 0.9);
    assert.strictEqual(result[1535], 0.9);
  } finally {
    env.VOYAGE_API_KEY = originalVoyageKey;
    env.NOMIC_API_KEY = originalNomicKey;
    globalThis.fetch = originalFetch;
  }
});

test("Embedding Service - Nomic API success and 1536 padding", async () => {
  const originalVoyageKey = env.VOYAGE_API_KEY;
  const originalNomicKey = env.NOMIC_API_KEY;
  const originalFetch = globalThis.fetch;

  env.VOYAGE_API_KEY = undefined;
  env.NOMIC_API_KEY = "mock_nomic_key";

  let calledUrl = "";
  let calledOptions: any = null;

  globalThis.fetch = async (url: any, options: any) => {
    calledUrl = url.toString();
    calledOptions = options;
    return {
      ok: true,
      json: async () => ({
        embeddings: [
          Array(768).fill(0.8)
        ]
      })
    } as any;
  };

  try {
    resetEmbeddingImplementation();
    const result = await createEmbedding("test nomic text");

    assert.strictEqual(calledUrl, "https://api-atlas.nomic.ai/v1/embedding/text");
    assert.strictEqual(calledOptions?.method, "POST");
    const body = JSON.parse(calledOptions?.body);
    assert.deepStrictEqual(body.texts, ["test nomic text"]);
    assert.strictEqual(body.model, "nomic-embed-text-v1.5");
    assert.strictEqual(body.task_type, "search_document");

    // Check padding logic (768 mock dimensions + 768 zeros = 1536)
    assert.strictEqual(result.length, 1536);
    assert.strictEqual(result[0], 0.8);
    assert.strictEqual(result[767], 0.8);
    assert.strictEqual(result[768], 0);
    assert.strictEqual(result[1535], 0);
  } finally {
    env.VOYAGE_API_KEY = originalVoyageKey;
    env.NOMIC_API_KEY = originalNomicKey;
    globalThis.fetch = originalFetch;
  }
});
