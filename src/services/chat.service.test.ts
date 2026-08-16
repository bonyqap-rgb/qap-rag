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

test("ChatService.chat - Artigo 6º do CPM exact retrieval and sources match context", async () => {
  const originalSearch = SearchService.search;
  SearchService.search = async () => [
    {
      documentId: "doc-cpm-123",
      chunkIndex: 5,
      score: 0.99,
      text: "Art. 6º Considera-se praticado o crime no lugar em que ocorreu a ação ou omissão...",
    },
  ];

  const originalFrom = supabase.from;
  supabase.from = function (table: string) {
    if (table === "knowledge_documents") {
      return {
        select: () => ({
          in: () => Promise.resolve({
            data: [{ id: "doc-cpm-123", file_name: "cpm.pdf" }],
            error: null,
          }),
        }),
      } as any;
    }
    return originalFrom.call(supabase, table);
  };

  let receivedUserPrompt = "";
  setChatImplementation(async (question, context, options) => {
    receivedUserPrompt = options?.userPrompt || "";
    return "De acordo com o Art. 6º do Código Penal Militar, considera-se praticado o crime no lugar em que ocorreu a ação ou omissão.";
  });

  try {
    const res = await ChatService.chat("Qual é o conteúdo do artigo 6º do Código Penal Militar?");

    assert.ok(receivedUserPrompt.includes("Art. 6º Considera-se praticado o crime"));
    assert.strictEqual(res.sources.length, 1);
    assert.strictEqual(res.sources[0].filename, "cpm.pdf");
    assert.strictEqual(res.sources[0].chunkIndex, 5);
    assert.strictEqual(res.sources[0].score, 0.99);
  } finally {
    SearchService.search = originalSearch;
    supabase.from = originalFrom;
    resetChatImplementation();
  }
});

test("ChatService.chat - Artigo 13 do RDPM exact retrieval and sources match context", async () => {
  const originalSearch = SearchService.search;
  SearchService.search = async () => [
    {
      documentId: "doc-rdpm-456",
      chunkIndex: 12,
      score: 0.99,
      text: "Art. 13 São transgressões disciplinares de natureza grave...",
    },
  ];

  const originalFrom = supabase.from;
  supabase.from = function (table: string) {
    if (table === "knowledge_documents") {
      return {
        select: () => ({
          in: () => Promise.resolve({
            data: [{ id: "doc-rdpm-456", file_name: "rdpm.pdf" }],
            error: null,
          }),
        }),
      } as any;
    }
    return originalFrom.call(supabase, table);
  };

  let receivedUserPrompt = "";
  setChatImplementation(async (question, context, options) => {
    receivedUserPrompt = options?.userPrompt || "";
    return "O artigo 13 do RDPM especifica as transgressões disciplinares de natureza grave.";
  });

  try {
    const res = await ChatService.chat("Traga o artigo 13 do RDPM");

    assert.ok(receivedUserPrompt.includes("Art. 13 São transgressões disciplinares de natureza grave"));
    assert.strictEqual(res.sources.length, 1);
    assert.strictEqual(res.sources[0].filename, "rdpm.pdf");
    assert.strictEqual(res.sources[0].chunkIndex, 12);
    assert.strictEqual(res.sources[0].score, 0.99);
  } finally {
    SearchService.search = originalSearch;
    supabase.from = originalFrom;
    resetChatImplementation();
  }
});
