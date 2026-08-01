process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy_key";
process.env.GROQ_API_KEY = "dummy_key";
import { test, mock } from "node:test";
import assert from "node:assert";
import { supabase } from "../config/supabase.js";
import { SearchService } from "./search.service.js";
import { ContextBuilderService } from "./context-builder.service.js";

import { setEmbeddingImplementation, resetEmbeddingImplementation } from "../groq/embed.js";

// Stub the embedding implementation directly for consistent and fast mock vectors
setEmbeddingImplementation(async (text) => {
  if (text === "error-trigger") {
    throw new Error("Internal DB Error");
  }
  return Array(1536).fill(0.1);
});

test("ContextBuilderService - buildContext removes duplicates", () => {
  const chunks = [
    { documentId: "doc-1", chunkIndex: 0, text: "Trecho 1" },
    { documentId: "doc-1", chunkIndex: 1, text: "Trecho 2" },
    { documentId: "doc-1", chunkIndex: 2, text: "Trecho 1" }, // Duplicate
  ];

  const context = ContextBuilderService.buildContext(chunks, 1000);
  assert.strictEqual(context, "Trecho 1\n\nTrecho 2");
});

test("ContextBuilderService - buildContext preserves document order", () => {
  const chunks = [
    { documentId: "doc-1", chunkIndex: 2, text: "Parte 3" },
    { documentId: "doc-2", chunkIndex: 0, text: "Parte A" },
    { documentId: "doc-1", chunkIndex: 0, text: "Parte 1" },
    { documentId: "doc-1", chunkIndex: 1, text: "Parte 2" },
  ];

  const context = ContextBuilderService.buildContext(chunks, 1000);
  // doc-1 parts sorted by index (Parte 1 -> Parte 2 -> Parte 3)
  // then doc-2 (Parte A)
  assert.strictEqual(context, "Parte 1\n\nParte 2\n\nParte 3\n\nParte A");
});

test("ContextBuilderService - buildContext respects maximum context size", () => {
  const chunks = [
    { documentId: "doc-1", chunkIndex: 0, text: "Parte 1 - Texto bem comprido" },
    { documentId: "doc-1", chunkIndex: 1, text: "Parte 2" },
    { documentId: "doc-1", chunkIndex: 2, text: "Parte 3" },
  ];

  // maxContextSize = 35 characters, which only fits the first chunk
  const context = ContextBuilderService.buildContext(chunks, 35);
  assert.strictEqual(context, "Parte 1 - Texto bem comprido");

  // maxContextSize = 10, which doesn't even fit the first chunk completely -> should truncate it
  const truncatedContext = ContextBuilderService.buildContext(chunks, 10);
  assert.strictEqual(truncatedContext, "Parte 1 - ");
});

test("SearchService - search successfully with results sorted by score", async () => {
  // Stub supabase.rpc
  const originalRpc = supabase.rpc;
  supabase.rpc = function (fnName: string, args: any) {
    if (fnName === "match_documents") {
      return {
        data: [
          {
            document_id: "doc-1",
            chunk_index: 0,
            content: "[METADATA:{\"sourceDocument\":\"test.pdf\"}]\nEste é o primeiro trecho.",
            similarity: 0.85,
          },
          {
            document_id: "doc-1",
            chunk_index: 1,
            content: "[METADATA:{\"sourceDocument\":\"test.pdf\"}]\nEste é o segundo trecho.",
            similarity: 0.95, // Higher similarity
          },
        ],
        error: null,
      } as any;
    }
    return originalRpc.call(supabase, fnName as any, args);
  } as any;

  try {
    const results = await SearchService.search("teste", 5, 0.3);

    assert.strictEqual(results.length, 2);
    // Should be sorted by score descending
    assert.strictEqual(results[0].score, 0.95);
    assert.strictEqual(results[0].text, "Este é o segundo trecho.");
    assert.strictEqual(results[1].score, 0.85);
    assert.strictEqual(results[1].text, "Este é o primeiro trecho.");
  } finally {
    supabase.rpc = originalRpc;
  }
});

test("SearchService - search applies scoreThreshold correctly", async () => {
  const originalRpc = supabase.rpc;
  supabase.rpc = function (fnName: string) {
    if (fnName === "match_documents") {
      return {
        data: [
          {
            document_id: "doc-1",
            chunk_index: 0,
            content: "Trecho altamente relevante",
            similarity: 0.9,
          },
          {
            document_id: "doc-1",
            chunk_index: 1,
            content: "Trecho irrelevante",
            similarity: 0.2, // Below threshold
          },
        ],
        error: null,
      } as any;
    }
    return originalRpc.call(supabase, fnName as any);
  } as any;

  try {
    const results = await SearchService.search("teste", 5, 0.5);

    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].score, 0.9);
    assert.strictEqual(results[0].text, "Trecho altamente relevante");
  } finally {
    supabase.rpc = originalRpc;
  }
});

test("SearchService - search handles empty results", async () => {
  const originalRpc = supabase.rpc;
  supabase.rpc = function (fnName: string) {
    if (fnName === "match_documents") {
      return { data: [], error: null } as any;
    }
    return originalRpc.call(supabase, fnName as any);
  } as any;

  try {
    const results = await SearchService.search("teste", 5, 0.3);
    assert.strictEqual(results.length, 0);
  } finally {
    supabase.rpc = originalRpc;
  }
});

test("SearchService - search with documentId filter", async () => {
  let calledWithDocumentId: string | null = null;
  const originalRpc = supabase.rpc;

  supabase.rpc = function (fnName: string, args: any) {
    if (fnName === "match_documents") {
      const queryBuilder = {
        eq: (col: string, val: string) => {
          if (col === "document_id") calledWithDocumentId = val;
          return Promise.resolve({
            data: [
              {
                document_id: val,
                chunk_index: 0,
                content: "Trecho filtrado",
                similarity: 0.8,
              },
            ],
            error: null,
          });
        },
        then: (resolve: any) =>
          resolve({
            data: [],
            error: null,
          }),
      };
      return queryBuilder as any;
    }
    return originalRpc.call(supabase, fnName as any, args);
  } as any;

  try {
    const results = await SearchService.search("teste", 5, 0.3, {
      documentId: "doc-filtrado-123",
    });

    assert.strictEqual(calledWithDocumentId, "doc-filtrado-123");
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].documentId, "doc-filtrado-123");
  } finally {
    supabase.rpc = originalRpc;
  }
});


test("SearchService - search handles error scenarios", async () => {
  // 1. Text validation error
  await assert.rejects(
    () => SearchService.search("", 5, 0.3),
    /O texto de busca não pode ser vazio/
  );

  // 2. RPC Error propagation
  const originalRpc = supabase.rpc;
  supabase.rpc = function () {
    return { data: null, error: { message: "Internal DB Error" } } as any;
  } as any;

  try {
    await assert.rejects(
      () => SearchService.search("teste", 5, 0.3),
      /Erro na busca vetorial por RPC.*Internal DB Error/
    );
  } finally {
    supabase.rpc = originalRpc;
  }
});
