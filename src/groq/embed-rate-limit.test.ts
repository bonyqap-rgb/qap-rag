process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy_key";
process.env.GROQ_API_KEY = "dummy_key";

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { env } from "../config/env.js";
import { createEmbedding, resetEmbeddingImplementation } from "./embed.js";
import { groqEmbeddingCircuitBreaker, CircuitState } from "../services/circuit-breaker.service.js";

const originalFetch = globalThis.fetch;
const originalVoyageKey = env.VOYAGE_API_KEY;
const originalNomicKey = env.NOMIC_API_KEY;

beforeEach(() => {
  env.VOYAGE_API_KEY = "mock_voyage_key";
  env.NOMIC_API_KEY = undefined;
  groqEmbeddingCircuitBreaker.reset();
});

afterEach(() => {
  env.VOYAGE_API_KEY = originalVoyageKey;
  env.NOMIC_API_KEY = originalNomicKey;
  globalThis.fetch = originalFetch;
  resetEmbeddingImplementation();
  groqEmbeddingCircuitBreaker.reset();
});

test("Embedding Service - 429 rate limit handles retries and throws status 503", async () => {
  let fetchCallCount = 0;

  // Mock global fetch to return 429 Rate Limit error
  globalThis.fetch = async (url: any, options: any) => {
    fetchCallCount++;
    return {
      ok: false,
      status: 429,
      text: async () => "Rate limit exceeded (Mocked 429 Error)",
    } as any;
  };

  try {
    // Override retry configs for fast testing
    const originalRetries = env.LLM_RETRIES;
    const originalDelay = env.LLM_RETRY_DELAY;
    env.LLM_RETRIES = 2;
    env.LLM_RETRY_DELAY = 10; // 10ms instead of 1000ms for ultra fast testing

    await assert.rejects(
      async () => {
        await createEmbedding("test 429 error");
      },
      (err: any) => {
        console.log("THE ACTUAL ERROR CAST IN TEST IS:", err);
        // Confirm the thrown error has status 503 (mapped to prevent client-level 429 confusion)
        assert.strictEqual(err.status, 503);
        assert.ok(err.message.includes("Mocked 429 Error"));
        return true;
      }
    );

    // Confirm it retried several times (maxRetries is 6 for 429 errors)
    assert.strictEqual(fetchCallCount, 6);

    // Verify that the Circuit Breaker did NOT trip/open because of the 429 errors
    assert.strictEqual(groqEmbeddingCircuitBreaker.getState(), CircuitState.CLOSED);

    // Restore
    env.LLM_RETRIES = originalRetries;
    env.LLM_RETRY_DELAY = originalDelay;
  } finally {
    globalThis.fetch = originalFetch;
  }
});
