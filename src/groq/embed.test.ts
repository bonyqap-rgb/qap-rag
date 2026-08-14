import { test } from "node:test";
import assert from "node:assert";
import { env } from "../config/env.js";
import { createEmbedding, resetEmbeddingImplementation, setEmbeddingImplementation, groq } from "./embed.js";

test("Embedding Service - Gemini text-embedding-004 success returning 768 dimensions", async () => {
  const originalGeminiKey = env.GEMINI_API_KEY;
  const originalFetch = globalThis.fetch;

  env.GEMINI_API_KEY = "mock_gemini_key";

  let calledUrl = "";
  let calledOptions: any = null;

  globalThis.fetch = async (url: any, options: any) => {
    calledUrl = url.toString();
    calledOptions = options;
    return {
      ok: true,
      json: async () => ({
        embedding: {
          values: Array(768).fill(0.123)
        }
      })
    } as any;
  };

  try {
    resetEmbeddingImplementation();
    const result = await createEmbedding("test gemini embedding text");

    assert.ok(calledUrl.includes("text-embedding-004:embedContent"));
    assert.strictEqual(calledOptions?.method, "POST");
    const body = JSON.parse(calledOptions?.body);
    assert.strictEqual(body.model, "models/text-embedding-004");
    assert.strictEqual(body.content.parts[0].text, "test gemini embedding text");

    assert.strictEqual(result.length, 768);
    assert.strictEqual(result[0], 0.123);
    assert.strictEqual(result[767], 0.123);
  } finally {
    env.GEMINI_API_KEY = originalGeminiKey;
    globalThis.fetch = originalFetch;
  }
});

test("Embedding Service - Groq SDK success returning 768 dimensions", async () => {
  const originalGeminiKey = env.GEMINI_API_KEY;
  const originalVoyageKey = env.VOYAGE_API_KEY;
  const originalNomicKey = env.NOMIC_API_KEY;
  const originalGroqKey = env.GROQ_API_KEY;

  env.GEMINI_API_KEY = undefined;
  env.VOYAGE_API_KEY = undefined;
  env.NOMIC_API_KEY = undefined;
  env.GROQ_API_KEY = "mock_groq_key";

  // Mock groq.embeddings.create
  const originalCreate = groq.embeddings.create;
  (groq.embeddings as any).create = async () => {
    return {
      data: [
        {
          embedding: Array(768).fill(0.7),
          index: 0,
          object: "embedding",
        }
      ],
      model: "nomic-embed-text-v1_5",
      object: "list",
      usage: { prompt_tokens: 10, total_tokens: 10 },
    } as any;
  };

  try {
    resetEmbeddingImplementation();
    const result = await createEmbedding("test groq text");

    assert.strictEqual(result.length, 768);
    assert.strictEqual(result[0], 0.7);
    assert.strictEqual(result[767], 0.7);
  } finally {
    env.GEMINI_API_KEY = originalGeminiKey;
    env.VOYAGE_API_KEY = originalVoyageKey;
    env.NOMIC_API_KEY = originalNomicKey;
    env.GROQ_API_KEY = originalGroqKey;
    (groq.embeddings as any).create = originalCreate;
    resetEmbeddingImplementation();
  }
});
