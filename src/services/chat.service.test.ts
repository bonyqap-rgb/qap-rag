process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy_key";
process.env.GEMINI_API_KEY = "dummy_key";
import { test } from "node:test";
import assert from "node:assert";
import { ChatService } from "./chat.service.js";
import { SearchService } from "./search.service.js";
import { ContextBuilderService } from "./context-builder.service.js";
import { setChatImplementation, resetChatImplementation } from "../gemini/chat.js";
import { supabase } from "../config/supabase.js";

test("ChatService.chat - full flow with context found", async () => {
  // Stub SearchService.search
  const originalSearch = SearchService.search;
  SearchService.search = async () => [
    {
      documentId: "doc-uuid-123",
      chunkIndex: 3,
      score: 0.94,
      text: "O policiamento comunitário foca na proximidade.",
    },
  ];

  // Stub ContextBuilderService.buildContext
  const originalBuildContext = ContextBuilderService.buildContext;
  ContextBuilderService.buildContext = () => "O policiamento comunitário foca na proximidade.";

  // Stub supabase.from to mock filename lookup
  const originalFrom = supabase.from;
  supabase.from = function (table: string) {
    if (table === "knowledge_documents") {
      return {
        select: () => ({
          in: () => Promise.resolve({
            data: [{ id: "doc-uuid-123", file_name: "manual_pm.pdf" }],
            error: null,
          }),
        }),
      } as any;
    }
    return originalFrom.call(supabase, table);
  };

  // Stub chatWithContextConfigurable using live binding helper
  setChatImplementation(async () => {
    return "O policiamento comunitário é baseado em proximidade e parceria.";
  });

  try {
    const res = await ChatService.chat("como funciona o policiamento comunitário?", {
      temperature: 0.1,
    });

    assert.strictEqual(res.answer, "O policiamento comunitário é baseado em proximidade e parceria.");
    assert.strictEqual(res.sources.length, 1);
    assert.strictEqual(res.sources[0].documentId, "doc-uuid-123");
    assert.strictEqual(res.sources[0].filename, "manual_pm.pdf");
    assert.strictEqual(res.sources[0].chunkIndex, 3);
    assert.strictEqual(res.sources[0].score, 0.94);

    assert.ok(res.metadata.searchTime.endsWith("ms"));
    assert.ok(res.metadata.generationTime.endsWith("ms"));
    assert.ok(res.metadata.totalTime.endsWith("ms"));
  } finally {
    SearchService.search = originalSearch;
    ContextBuilderService.buildContext = originalBuildContext;
    supabase.from = originalFrom;
    resetChatImplementation();
  }
});

test("ChatService.chat - context empty scenario", async () => {
  const originalSearch = SearchService.search;
  SearchService.search = async () => []; // No chunks found

  try {
    const res = await ChatService.chat("Qual é a capital de Marte?");

    assert.strictEqual(res.answer, "Não encontrei essa informação na base de conhecimento.");
    assert.strictEqual(res.sources.length, 0);
    assert.strictEqual(res.metadata.generationTime, "0ms");
  } finally {
    SearchService.search = originalSearch;
  }
});

test("ChatService.chat - Gemini failure scenario", async () => {
  const originalSearch = SearchService.search;
  SearchService.search = async () => [
    {
      documentId: "doc-uuid-123",
      chunkIndex: 0,
      score: 0.8,
      text: "Algum texto relevante",
    },
  ];

  const originalFrom = supabase.from;
  supabase.from = function (table: string) {
    if (table === "knowledge_documents") {
      return {
        select: () => ({
          in: () => Promise.resolve({
            data: [{ id: "doc-uuid-123", file_name: "test.pdf" }],
            error: null,
          }),
        }),
      } as any;
    }
    return originalFrom.call(supabase, table);
  };

  setChatImplementation(async () => {
    throw new Error("API Key inválida");
  });

  try {
    await assert.rejects(
      () => ChatService.chat("teste de erro"),
      (err: any) => {
        assert.strictEqual(err.status, 502);
        assert.ok(err.message.includes("Falha ao gerar resposta do Gemini: API Key inválida"));
        return true;
      }
    );
  } finally {
    SearchService.search = originalSearch;
    supabase.from = originalFrom;
    resetChatImplementation();
  }
});

test("ChatService.chat - Timeout scenario", async () => {
  const originalSearch = SearchService.search;
  SearchService.search = async () => [
    {
      documentId: "doc-uuid-123",
      chunkIndex: 0,
      score: 0.8,
      text: "Algum texto relevante",
    },
  ];

  const originalFrom = supabase.from;
  supabase.from = function (table: string) {
    if (table === "knowledge_documents") {
      return {
        select: () => ({
          in: () => Promise.resolve({
            data: [{ id: "doc-uuid-123", file_name: "test.pdf" }],
            error: null,
          }),
        }),
      } as any;
    }
    return originalFrom.call(supabase, table);
  };

  setChatImplementation(async () => {
    throw new Error("Operação excedeu o tempo limite de 5000ms");
  });

  try {
    await assert.rejects(
      () => ChatService.chat("teste de timeout", { timeout: 5000 }),
      (err: any) => {
        assert.strictEqual(err.status, 504);
        assert.ok(err.message.includes("O tempo limite de processamento de 5000ms foi excedido."));
        return true;
      }
    );
  } finally {
    SearchService.search = originalSearch;
    supabase.from = originalFrom;
    resetChatImplementation();
  }
});

test("ChatService.chat - input validation empty question", async () => {
  await assert.rejects(
    () => ChatService.chat("  "),
    (err: any) => {
      assert.strictEqual(err.status, 400);
      assert.strictEqual(err.message, "A pergunta não pode ser vazia.");
      return true;
    }
  );
});

test("ChatService.chat - gemini-2.5-flash model sanitization and fallback", async () => {
  const originalSearch = SearchService.search;
  SearchService.search = async () => [
    {
      documentId: "doc-uuid-123",
      chunkIndex: 0,
      score: 0.8,
      text: "Algum texto relevante",
    },
  ];

  const originalFrom = supabase.from;
  supabase.from = function (table: string) {
    if (table === "knowledge_documents") {
      return {
        select: () => ({
          in: () => Promise.resolve({
            data: [{ id: "doc-uuid-123", file_name: "test.pdf" }],
            error: null,
          }),
        }),
      } as any;
    }
    return originalFrom.call(supabase, table);
  };

  let capturedModel: string | undefined;
  setChatImplementation(async (question, context, options) => {
    capturedModel = options?.model;
    return "Resposta mockada.";
  });

  try {
    const res = await ChatService.chat("teste de sanitização", {
      model: "models/gemini-2.5-flash",
    });

    assert.strictEqual(res.answer, "Resposta mockada.");
    assert.strictEqual(capturedModel, "gemini-2.0-flash");
  } finally {
    SearchService.search = originalSearch;
    supabase.from = originalFrom;
    resetChatImplementation();
  }
});
