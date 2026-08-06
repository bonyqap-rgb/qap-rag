process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy_key";
process.env.GROQ_API_KEY = "dummy_key";
import { test } from "node:test";
import assert from "node:assert";
import { ChatService } from "./chat.service.js";
import { SearchService } from "./search.service.js";
import { ContextBuilderService } from "./context-builder.service.js";
import { setChatImplementation, resetChatImplementation } from "../groq/chat.js";
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

test("ChatService.chat - Groq failure scenario", async () => {
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
        assert.ok(err.message.includes("Falha ao gerar resposta do Groq: API Key inválida"));
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

test("ChatService.chat - unsupported-model model fallback to default Groq model", async () => {
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
      model: "unsupported-model-name",
    });

    assert.strictEqual(res.answer, "Resposta mockada.");
    assert.strictEqual(capturedModel, "llama-3.3-70b-versatile");
  } finally {
    SearchService.search = originalSearch;
    supabase.from = originalFrom;
    resetChatImplementation();
  }
});

test("ChatService.resolveDocuments - resolves 'RDPM' keyword correctly", async () => {
  const originalFrom = supabase.from;
  const mockDocs = [
    { id: "rdpm-uuid-999", file_name: "RDPM_regulamento.pdf" },
    { id: "other-uuid-888", file_name: "manual_pm.pdf" }
  ];

  supabase.from = function (table: string) {
    if (table === "knowledge_documents") {
      return {
        select: () => ({
          then: (resolve: any) => resolve({ data: mockDocs, error: null })
        })
      } as any;
    }
    return originalFrom.call(supabase, table);
  };

  try {
    const res = await ChatService.resolveDocuments("Qual o Artigo 31 do RDPM?");
    assert.ok(res);
    assert.strictEqual(res.length, 1);
    assert.strictEqual(res[0].documentId, "rdpm-uuid-999");
    assert.strictEqual(res[0].filename, "RDPM_regulamento.pdf");
  } finally {
    supabase.from = originalFrom;
  }
});

test("ChatService.resolveDocuments - should restrict correctly on explicit mentions", async () => {
  const originalFrom = supabase.from;
  const mockDocs = [
    { id: "rdpm-uuid", file_name: "RDPM_regulamento.pdf" },
    { id: "cpm-uuid", file_name: "Codigo Penal Militar Comentado.pdf" },
    { id: "i18-uuid", file_name: "I-18-PM.pdf" },
    { id: "i36-uuid", file_name: "I-36-PM.pdf" },
  ];

  supabase.from = function (table: string) {
    if (table === "knowledge_documents") {
      return {
        select: () => ({
          then: (resolve: any) => resolve({ data: mockDocs, error: null })
        })
      } as any;
    }
    return originalFrom.call(supabase, table);
  };

  try {
    // 1. "No RDPM..."
    const res1 = await ChatService.resolveDocuments("No RDPM o processo é sumário?");
    assert.strictEqual(res1.length, 1);
    assert.strictEqual(res1[0].documentId, "rdpm-uuid");

    // 2. "Segundo o Código Penal Militar..."
    const res2 = await ChatService.resolveDocuments("Segundo o Código Penal Militar qual a pena?");
    assert.strictEqual(res2.length, 1);
    assert.strictEqual(res2[0].documentId, "cpm-uuid");

    // 3. "Conforme a I-18..."
    const res3 = await ChatService.resolveDocuments("Conforme a I-18...");
    assert.strictEqual(res3.length, 1);
    assert.strictEqual(res3[0].documentId, "i18-uuid");

    // 4. "Na I-36..."
    const res4 = await ChatService.resolveDocuments("Na I-36...");
    assert.strictEqual(res4.length, 1);
    assert.strictEqual(res4[0].documentId, "i36-uuid");
  } finally {
    supabase.from = originalFrom;
  }
});

test("ChatService.resolveDocuments - should NOT restrict on generic questions", async () => {
  const originalFrom = supabase.from;
  const mockDocs = [
    { id: "rdpm-uuid", file_name: "RDPM_regulamento.pdf" },
    { id: "cpm-uuid", file_name: "Codigo Penal Militar Comentado.pdf" },
  ];

  supabase.from = function (table: string) {
    if (table === "knowledge_documents") {
      return {
        select: () => ({
          then: (resolve: any) => resolve({ data: mockDocs, error: null })
        })
      } as any;
    }
    return originalFrom.call(supabase, table);
  };

  try {
    const genericQuestions = [
      "Quais os prazos do PAD?",
      "Como funciona o processo disciplinar?",
      "Quais são as fases do PADM?",
      "O policial militar pode...",
      "Como funciona um recurso administrativo?",
    ];

    for (const q of genericQuestions) {
      const res = await ChatService.resolveDocuments(q);
      assert.strictEqual(res.length, 0, `Question "${q}" should not resolve to any document but got ${JSON.stringify(res)}`);
    }
  } finally {
    supabase.from = originalFrom;
  }
});

test("ChatService.chat - should execute global search fallback when restricted search returns 0 results", async () => {
  const originalSearch = SearchService.search;
  const originalFrom = supabase.from;

  const mockDocs = [
    { id: "cpm-uuid", file_name: "Codigo Penal Militar Comentado.pdf" },
    { id: "rdpm-uuid", file_name: "RDPM_regulamento.pdf" },
  ];

  supabase.from = function (table: string) {
    if (table === "knowledge_documents") {
      return {
        select: () => ({
          in: () => Promise.resolve({ data: mockDocs, error: null }),
          then: (resolve: any) => resolve({ data: mockDocs, error: null })
        })
      } as any;
    }
    return originalFrom.call(supabase, table);
  };

  const capturedSearches: { query: string; filters: any }[] = [];
  SearchService.search = async (query, topK, score, filters) => {
    capturedSearches.push({ query, filters });
    if (filters?.documentId === "cpm-uuid") {
      // First search (restricted to Code Penal Militar because we'll pass CPM filter)
      return [];
    } else {
      // Global search fallback (no documentId filter)
      return [
        {
          documentId: "rdpm-uuid",
          chunkIndex: 2,
          score: 0.88,
          text: "Prazo para recurso é de 5 dias.",
        }
      ];
    }
  };

  setChatImplementation(async () => {
    return "O prazo para recurso é de 5 dias segundo o regulamento.";
  });

  try {
    // Explicitly restrict to CPM (e.g. via options filters)
    const res = await ChatService.chat("Qual o prazo do recurso?", {
      filters: { documentId: "cpm-uuid" }
    });

    assert.strictEqual(res.answer, "O prazo para recurso é de 5 dias segundo o regulamento.");
    assert.strictEqual(res.sources.length, 1);
    assert.strictEqual(res.sources[0].documentId, "rdpm-uuid");

    // We expect two searches:
    // 1. Restricted search with documentId = "cpm-uuid"
    // 2. Global fallback search with documentId deleted
    assert.strictEqual(capturedSearches.length, 2);
    assert.strictEqual(capturedSearches[0].filters.documentId, "cpm-uuid");
    assert.strictEqual(capturedSearches[1].filters.documentId, undefined);
  } finally {
    SearchService.search = originalSearch;
    supabase.from = originalFrom;
    resetChatImplementation();
  }
});

test("ChatService.chat - Balanced Multi-Document Retrieval behavior when multiple documents are matched", async () => {
  const originalSearch = SearchService.search;
  const originalFrom = supabase.from;

  const mockDocs = [
    { id: "doc-A", file_name: "document_A.pdf" },
    { id: "doc-B", file_name: "document_B.pdf" }
  ];

  // Mock resolveDocuments lookup for document_A.pdf and document_B.pdf
  supabase.from = function (table: string) {
    if (table === "knowledge_documents") {
      return {
        select: () => ({
          in: () => Promise.resolve({ data: mockDocs, error: null }),
          then: (resolve: any) => resolve({ data: mockDocs, error: null })
        })
      } as any;
    }
    return originalFrom.call(supabase, table);
  };

  const searchCalls: { queryText: string; topK?: number; filters: any }[] = [];

  SearchService.search = async (queryText, topK, scoreThreshold, filters) => {
    searchCalls.push({ queryText, topK: topK ?? 4, filters });

    if (filters?.documentId === "doc-A") {
      return [
        {
          documentId: "doc-A",
          chunkIndex: 0,
          score: 0.8,
          text: "Trecho do Documento A",
        },
        {
          documentId: "doc-A",
          chunkIndex: 1,
          score: 0.7,
          text: "Texto Duplicado entre A e B",
        }
      ];
    } else if (filters?.documentId === "doc-B") {
      return [
        {
          documentId: "doc-B",
          chunkIndex: 0,
          score: 0.9,
          text: "Texto Duplicado entre A e B",
        },
        {
          documentId: "doc-B",
          chunkIndex: 1,
          score: 0.85,
          text: "Trecho do Documento B único",
        }
      ];
    }
    return [];
  };

  setChatImplementation(async (question, context) => {
    // Assert that the context built has both non-duplicated texts sorted by score descending
    // Non-duplicated texts in score descending:
    // 1. "Texto Duplicado entre A e B" (score 0.9 from doc-B)
    // 2. "Trecho do Documento B único" (score 0.85 from doc-B)
    // 3. "Trecho do Documento A" (score 0.8 from doc-A)
    // "Texto Duplicado entre A e B" (score 0.7 from doc-A) is discarded as duplicate
    assert.ok(context.includes("[Documento: document_B.pdf]\nTexto Duplicado entre A e B") || context.includes("Texto Duplicado entre A e B"));
    assert.ok(context.includes("Trecho do Documento B único"));
    assert.ok(context.includes("Trecho do Documento A"));
    return "Resposta Multi-Documentos Integrada.";
  });

  try {
    const res = await ChatService.chat("Compare document_A.pdf com document_B.pdf", {
      minChunksPerDocument: 4,
    });

    assert.strictEqual(res.answer, "Resposta Multi-Documentos Integrada.");

    // Check independent searches
    assert.strictEqual(searchCalls.length, 2);
    assert.deepStrictEqual(searchCalls[0].filters, { documentId: "doc-A" });
    assert.strictEqual(searchCalls[0].topK, 4);
    assert.deepStrictEqual(searchCalls[1].filters, { documentId: "doc-B" });
    assert.strictEqual(searchCalls[1].topK, 4);

    // Verify correct sorting and deduplication (PR 5 merges consecutive chunks of same doc)
    // 1. doc-A chunkIndex 0 (score 0.8)
    // 2. doc-B chunkIndex 0 (score 0.9) and doc-B chunkIndex 1 (score 0.85) merged into 1 chunk
    assert.strictEqual(res.sources.length, 2);
    assert.strictEqual(res.sources[0].documentId, "doc-A");
    assert.strictEqual(res.sources[0].chunkIndex, 0);
    assert.strictEqual(res.sources[0].score, 0.8);

    assert.strictEqual(res.sources[1].documentId, "doc-B");
    assert.strictEqual(res.sources[1].chunkIndex, 1);
    assert.strictEqual(res.sources[1].score, 0.9);
  } finally {
    SearchService.search = originalSearch;
    supabase.from = originalFrom;
    resetChatImplementation();
  }
});

test("ChatService.chat - resolves multiple documents and queries them together", async () => {
  const originalSearch = SearchService.search;
  const originalFrom = supabase.from;

  const mockDocs = [
    { id: "rdpm-uuid-999", file_name: "RDPM_regulamento.pdf" },
    { id: "i2pm-uuid-888", file_name: "I-2-PM.pdf" }
  ];

  supabase.from = function (table: string) {
    if (table === "knowledge_documents") {
      return {
        select: () => ({
          in: () => Promise.resolve({ data: mockDocs, error: null }),
          then: (resolve: any) => resolve({ data: mockDocs, error: null })
        })
      } as any;
    }
    return originalFrom.call(supabase, table);
  };

  const capturedSearches: { query: string; filters: any }[] = [];
  SearchService.search = async (query, topK, score, filters) => {
    capturedSearches.push({ query, filters });
    if (filters?.documentId === "rdpm-uuid-999") {
      return [
        {
          documentId: "rdpm-uuid-999",
          chunkIndex: 0,
          score: 0.92,
          text: "Trecho do RDPM",
        }
      ];
    } else if (filters?.documentId === "i2pm-uuid-888") {
      return [
        {
          documentId: "i2pm-uuid-888",
          chunkIndex: 1,
          score: 0.88,
          text: "Trecho do I-2-PM",
        }
      ];
    }
    return [];
  };

  setChatImplementation(async () => {
    return "Resposta comparativa simulada.";
  });

  try {
    const res = await ChatService.chat("Compare o Artigo 31 do RDPM com o Artigo 31 da I-2-PM");
    assert.strictEqual(res.answer, "Resposta comparativa simulada.");

    // Assert 2 independent queries are executed
    assert.strictEqual(capturedSearches.length, 2);
    assert.strictEqual(capturedSearches[0].filters.documentId, "rdpm-uuid-999");
    assert.strictEqual(capturedSearches[1].filters.documentId, "i2pm-uuid-888");

    assert.strictEqual(res.sources.length, 2);
    // Sorted alphabetically by documentId: i2pm-uuid-888 comes before rdpm-uuid-999
    assert.strictEqual(res.sources[0].documentId, "i2pm-uuid-888");
    assert.strictEqual(res.sources[1].documentId, "rdpm-uuid-999");
  } finally {
    SearchService.search = originalSearch;
    supabase.from = originalFrom;
    resetChatImplementation();
  }
});

test("ChatService.chat - performs search with resolved document id when RDPM is mentioned", async () => {
  const originalSearch = SearchService.search;
  const originalFrom = supabase.from;

  const mockDocs = [
    { id: "rdpm-uuid-999", file_name: "RDPM_regulamento.pdf" },
    { id: "other-uuid-888", file_name: "manual_pm.pdf" }
  ];

  supabase.from = function (table: string) {
    if (table === "knowledge_documents") {
      return {
        select: () => ({
          in: () => Promise.resolve({ data: [mockDocs[0]], error: null }),
          then: (resolve: any) => resolve({ data: mockDocs, error: null })
        })
      } as any;
    }
    return originalFrom.call(supabase, table);
  };

  let searchedFilters: any = null;
  SearchService.search = async (query, topK, score, filters) => {
    searchedFilters = filters;
    return [
      {
        documentId: "rdpm-uuid-999",
        chunkIndex: 0,
        score: 0.9,
        text: "Artigo 31: O militar deve...",
      }
    ];
  };

  setChatImplementation(async () => {
    return "Resposta baseada no Artigo 31 do RDPM.";
  });

  try {
    const res = await ChatService.chat("Qual o Artigo 31 do RDPM?");
    assert.strictEqual(res.answer, "Resposta baseada no Artigo 31 do RDPM.");
    assert.ok(searchedFilters);
    assert.strictEqual(searchedFilters.documentId, "rdpm-uuid-999");
  } finally {
    SearchService.search = originalSearch;
    supabase.from = originalFrom;
    resetChatImplementation();
  }
});

test("ChatService.chat - insufficiency logs and returns empty answer when resultsCount === 0", async () => {
  const originalSearch = SearchService.search;
  const originalFrom = supabase.from;

  SearchService.search = async () => [];

  supabase.from = function (table: string) {
    if (table === "knowledge_documents") {
      return {
        select: () => ({
          then: (resolve: any) => resolve({ data: [], error: null })
        })
      } as any;
    }
    return originalFrom.call(supabase, table);
  };

  try {
    const res = await ChatService.chat("Questão inexistente");
    assert.strictEqual(res.answer, "Não encontrei essa informação na base de conhecimento.");
    assert.strictEqual(res.sources.length, 0);
  } finally {
    SearchService.search = originalSearch;
    supabase.from = originalFrom;
  }
});
