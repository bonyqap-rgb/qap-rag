import { test } from "node:test";
import assert from "node:assert";
import {
  createEmbedding,
  setEmbeddingImplementation,
  resetEmbeddingImplementation,
} from "./embed.js";

test("createEmbedding - throws explicit unfeasible error message by default", async () => {
  // Ensure we are using the default implementation
  resetEmbeddingImplementation();

  await assert.rejects(
    async () => {
      await createEmbedding("any text here");
    },
    {
      name: "Error",
      message: "A migração completa para Groq é inviável porque o serviço não fornece embeddings para este fluxo RAG.",
    }
  );
});

test("createEmbedding - supports overriding and resetting embedding implementation", async () => {
  // Override implementation
  setEmbeddingImplementation(async (text) => {
    return [1, 2, 3];
  });

  const result = await createEmbedding("test text");
  assert.deepStrictEqual(result, [1, 2, 3]);

  // Reset to default
  resetEmbeddingImplementation();

  await assert.rejects(
    async () => {
      await createEmbedding("test text");
    },
    {
      name: "Error",
      message: "A migração completa para Groq é inviável porque o serviço não fornece embeddings para este fluxo RAG.",
    }
  );
});
