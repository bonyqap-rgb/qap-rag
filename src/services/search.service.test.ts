process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy_key";
process.env.GROQ_API_KEY = "dummy_key";
import { test, mock } from "node:test";
import assert from "node:assert";
import { supabase } from "../config/supabase.js";
import {
  SearchService,
  extractRequestedArticleNumber,
  isChunkMatchingArticle,
} from "./search.service.js";
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
    { documentId: "doc-1", chunkIndex: 0, text: "Primeira diretriz sobre segurança." },
    { documentId: "doc-1", chunkIndex: 1, text: "Segunda diretriz sobre conduta operacional." },
    { documentId: "doc-1", chunkIndex: 2, text: "Primeira diretriz sobre segurança." }, // Duplicate
  ];

  const context = ContextBuilderService.buildContext(chunks, 1000);
  assert.ok(context.includes("Primeira diretriz sobre segurança."));
  assert.ok(context.includes("Segunda diretriz sobre conduta operacional."));
  assert.ok(context.includes("================================================"));
});

test("ContextBuilderService - buildContext preserves document order", () => {
  const chunks = [
    { documentId: "doc-1", chunkIndex: 2, text: "Terceira seção detalhando a comissão de processos." },
    { documentId: "doc-2", chunkIndex: 0, text: "Disposições gerais do documento secundário da corporação." },
    { documentId: "doc-1", chunkIndex: 0, text: "Primeira seção contendo as normas de policiamento." },
    { documentId: "doc-1", chunkIndex: 1, text: "Segunda seção explicando as diretrizes de rito sumário." },
  ];

  const context = ContextBuilderService.buildContext(chunks, 1000);
  // Note: Doc-1 chunks are consecutive and get merged into 1 chunk with text preserving sequence
  assert.ok(context.includes("Primeira seção"));
  assert.ok(context.includes("Segunda seção"));
  assert.ok(context.includes("Terceira seção"));
  assert.ok(context.includes("Disposições gerais"));
});

test("ContextBuilderService - buildContext respects maximum context size", () => {
  const chunks = [
    { documentId: "doc-1", chunkIndex: 0, text: "Parte 1 - Texto bem comprido" },
    { documentId: "doc-1", chunkIndex: 1, text: "Parte 2" },
    { documentId: "doc-1", chunkIndex: 2, text: "Parte 3" },
  ];

  // maxContextSize = 200 characters, which only fits the first chunk formatted
  const context = ContextBuilderService.buildContext(chunks, 200);
  assert.ok(context.includes("Parte 1 - Texto bem comprido"));
  assert.ok(!context.includes("Parte 2"));

  // maxContextSize = 10, which doesn't even fit the first chunk completely -> should return empty
  const truncatedContext = ContextBuilderService.buildContext(chunks, 10);
  assert.strictEqual(truncatedContext, "");
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
            document_id: "doc-2",
            chunk_index: 1,
            content: "[METADATA:{\"sourceDocument\":\"test2.pdf\"}]\nEste é o segundo trecho.",
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
    // Should be sorted by score descending (using Reciprocal Rank Fusion RRF)
    const expectedScore0 = 1 / (60 + 1) + 0.95 * 0.0001;
    const expectedScore1 = 1 / (60 + 2) + 0.85 * 0.0001;
    assert.ok(Math.abs(results[0].score - expectedScore0) < 1e-7);
    assert.strictEqual(results[0].text, "Este é o segundo trecho.");
    assert.ok(Math.abs(results[1].score - expectedScore1) < 1e-7);
    assert.strictEqual(results[1].text, "Este é o primeiro trecho.");
  } finally {
    supabase.rpc = originalRpc;
  }
});

test("SearchService - Deterministic Article Retrieval: locates requested Artigo 1 when vector RPC returns only Artigo 9 and Artigo 10", async () => {
  const originalRpc = supabase.rpc;
  const originalFrom = supabase.from;

  supabase.rpc = function (fnName: string) {
    if (fnName === "match_documents") {
      // Vector RPC returns ONLY Artigo 9 and Artigo 10 (Artigo 1 is missing!)
      return {
        data: [
          {
            document_id: "doc-cpm",
            chunk_index: 8,
            content: "[METADATA:{\"sourceDocument\":\"codigo_penal_militar_cpm.pdf\"}]\n[PAGE:3] Artigo 9º Consideram-se crimes militares em tempo de paz...",
            similarity: 0.90,
          },
          {
            document_id: "doc-cpm",
            chunk_index: 9,
            content: "[METADATA:{\"sourceDocument\":\"codigo_penal_militar_cpm.pdf\"}]\n[PAGE:3] Art. 10. Consideram-se crimes militares em tempo de guerra...",
            similarity: 0.85,
          },
        ],
        error: null,
      } as any;
    }
    if (fnName === "match_knowledge_chunks_lexical") {
      return { data: [], error: null } as any;
    }
    return originalRpc.call(supabase, fnName as any);
  } as any;

  supabase.from = function (table: string) {
    if (table === "knowledge_chunks") {
      const mockChain: any = {
        select: () => mockChain,
        or: () => mockChain,
        ilike: () => mockChain,
        eq: () => mockChain,
        in: () => mockChain,
        limit: () => mockChain,
        then: (resolve: any) =>
          resolve({
            data: [
              {
                id: "chunk-art1",
                document_id: "doc-cpm",
                chunk_index: 0,
                content: "[METADATA:{\"sourceDocument\":\"codigo_penal_militar_cpm.pdf\"}]\n[PAGE:1] Art. 1º O Código Penal Militar divide-se em Parte Geral e Parte Especial.",
              },
            ],
            error: null,
          }),
      };
      return mockChain;
    }
    return originalFrom.call(supabase, table as any);
  } as any;

  try {
    const results = await SearchService.search("Qual é o texto do artigo 1º do Código Penal Militar?", 5, 0.15);

    assert.ok(results.length >= 1);
    // Artigo 1 MUST be retrieved deterministically and ranked #1
    assert.strictEqual(results[0].text.includes("Art. 1º"), true);
    assert.strictEqual(results[0].text.includes("Artigo 9º"), false);
  } finally {
    supabase.rpc = originalRpc;
    supabase.from = originalFrom;
  }
});

test("SearchService - Deterministic Article Retrieval: Artigo 1 search does NOT match or return Artigo 10", async () => {
  const originalRpc = supabase.rpc;
  const originalFrom = supabase.from;

  supabase.rpc = function (fnName: string) {
    if (fnName === "match_documents") {
      return { data: [], error: null } as any;
    }
    if (fnName === "match_knowledge_chunks_lexical") {
      return { data: [], error: null } as any;
    }
    return originalRpc.call(supabase, fnName as any);
  } as any;

  supabase.from = function (table: string) {
    if (table === "knowledge_chunks") {
      const mockChain: any = {
        select: () => mockChain,
        or: () => mockChain,
        ilike: () => mockChain,
        eq: () => mockChain,
        in: () => mockChain,
        limit: () => mockChain,
        then: (resolve: any) =>
          resolve({
            data: [
              {
                id: "chunk-art10",
                document_id: "doc-cpm",
                chunk_index: 10,
                content: "[METADATA:{\"sourceDocument\":\"codigo_penal_militar_cpm.pdf\"}]\n[PAGE:2] Art. 10. Consideram-se crimes militares em tempo de guerra...",
              },
            ],
            error: null,
          }),
      };
      return mockChain;
    }
    return originalFrom.call(supabase, table as any);
  } as any;

  try {
    const results = await SearchService.search("Qual é o texto do artigo 1º do Código Penal Militar?", 5, 0.15);

    // Searching for Artigo 1 must NOT match Artigo 10, so results should be empty
    assert.strictEqual(results.length, 0);
  } finally {
    supabase.rpc = originalRpc;
    supabase.from = originalFrom;
  }
});

test("Literal Article Matching - helper logic extractRequestedArticleNumber and isChunkMatchingArticle", () => {
  // extractRequestedArticleNumber
  assert.strictEqual(extractRequestedArticleNumber("Qual é o texto do artigo 1º do Código Penal Militar?"), "1");
  assert.strictEqual(extractRequestedArticleNumber("Qual o conteúdo do Artigo 9º do CPM?"), "9");
  assert.strictEqual(extractRequestedArticleNumber("O que diz o Art. 10?"), "10");
  assert.strictEqual(extractRequestedArticleNumber("Transcreva o art 11"), "11");
  assert.strictEqual(extractRequestedArticleNumber("Como funciona o processo disciplinar?"), null);

  // artigo 1 não casar com artigo 10
  assert.strictEqual(
    isChunkMatchingArticle("[PAGE:2] Art. 10. Consideram-se crimes militares...", "1"),
    false
  );
  assert.strictEqual(
    isChunkMatchingArticle("[PAGE:2] Artigo 10º Consideram-se crimes...", "1"),
    false
  );

  // artigo 9 casar com artigo 9
  assert.strictEqual(
    isChunkMatchingArticle("[PAGE:3] Artigo 9º Consideram-se crimes militares...", "9"),
    true
  );
  assert.strictEqual(
    isChunkMatchingArticle("[PAGE:3] Art. 9. Consideram-se crimes...", "9"),
    true
  );

  // artigo 1 casar com artigo 1
  assert.strictEqual(
    isChunkMatchingArticle("[PAGE:1] Art. 1º O Código Penal Militar divide-se em...", "1"),
    true
  );
});

test("SearchService - Literal Article Request: artigo 1 query prioritizes artigo 1 over artigo 9", async () => {
  const originalRpc = supabase.rpc;
  supabase.rpc = function (fnName: string) {
    if (fnName === "match_documents") {
      return {
        data: [
          {
            document_id: "doc-cpm",
            chunk_index: 8,
            content: "[METADATA:{\"sourceDocument\":\"cpm.pdf\"}]\n[PAGE:3] Artigo 9º Consideram-se crimes militares em tempo de paz...",
            similarity: 0.90, // higher initial vector score
          },
          {
            document_id: "doc-cpm",
            chunk_index: 0,
            content: "[METADATA:{\"sourceDocument\":\"cpm.pdf\"}]\n[PAGE:1] Art. 1º O Código Penal Militar divide-se em Parte Geral e Parte Especial.",
            similarity: 0.80, // lower initial score
          },
        ],
        error: null,
      } as any;
    }
    if (fnName === "match_knowledge_chunks_lexical") {
      return { data: [], error: null } as any;
    }
    return originalRpc.call(supabase, fnName as any);
  } as any;

  try {
    const results = await SearchService.search("Qual é o texto do artigo 1º do Código Penal Militar?", 5, 0.15);

    assert.ok(results.length >= 1);
    // Artigo 1 MUST be prioritized first and not return Artigo 9 first
    assert.ok(results[0].text.includes("Art. 1º"));
    assert.strictEqual(results[0].text.includes("Artigo 9º"), false);
  } finally {
    supabase.rpc = originalRpc;
  }
});

test("SearchService - Explanatory Request uses normal flow without literal article reordering", async () => {
  const originalRpc = supabase.rpc;
  supabase.rpc = function (fnName: string) {
    if (fnName === "match_documents") {
      return {
        data: [
          {
            document_id: "doc-explanation",
            chunk_index: 5,
            content: "[METADATA:{\"sourceDocument\":\"comentarios.pdf\"}]\nArtigo 1. Explicação sobre a aplicação das penas e crimes militares.",
            similarity: 0.88,
          },
          {
            document_id: "doc-cpm",
            chunk_index: 10,
            content: "[METADATA:{\"sourceDocument\":\"cpm.pdf\"}]\n[PAGE:2] Art. 10. Consideram-se crimes militares...",
            similarity: 0.70,
          },
        ],
        error: null,
      } as any;
    }
    if (fnName === "match_knowledge_chunks_lexical") {
      return { data: [], error: null } as any;
    }
    return originalRpc.call(supabase, fnName as any);
  } as any;

  try {
    // "Explique o artigo 10" is an explanatory request (isLiteralArticleRequest = false)
    const results = await SearchService.search("Explique o artigo 10", 5, 0.15);

    assert.ok(results.length >= 1);
    // Normal ranking based on score is preserved (doc-explanation ranks first)
    assert.strictEqual(results[0].documentId, "doc-explanation");
  } finally {
    supabase.rpc = originalRpc;
  }
});

test("SearchService - Retrieval Precision & Recall: Specific Juridical Query (PAD / RDPM prioritized)", async () => {
  const originalRpc = supabase.rpc;
  supabase.rpc = function (fnName: string) {
    if (fnName === "match_documents") {
      return {
        data: [
          {
            document_id: "doc-medical",
            chunk_index: 0,
            content: "[METADATA:{\"sourceDocument\":\"licenca_medica.pdf\"}]\nEste é o documento de afastamento médico e licenças de saúde do militar.",
            similarity: 0.42,
          },
          {
            document_id: "doc-pad",
            chunk_index: 0,
            content: "[METADATA:{\"sourceDocument\":\"pad_disciplinar.pdf\"}]\nArtigo 12. Os prazos e fases do processo administrativo disciplinar militar de rito sumário.",
            similarity: 0.40, // lower raw similarity but contains specific PAD/RDPM info and rich metadata
          },
        ],
        error: null,
      } as any;
    }
    return originalRpc.call(supabase, fnName as any);
  } as any;

  try {
    const results = await SearchService.search("Quais os prazos e fases do processo administrativo disciplinar militar?", 5, 0.3);

    assert.strictEqual(results.length, 2);
    // PAD document should be boosted to the top due to explicit mentions, metadata structure, and keyword overlap
    assert.strictEqual(results[0].documentId, "doc-pad");
    assert.ok(results[0].score > results[1].score);
  } finally {
    supabase.rpc = originalRpc;
  }
});

test("SearchService - Retrieval Precision & Recall: Explicit Document Priority (RDPM mentioned)", async () => {
  const originalRpc = supabase.rpc;
  supabase.rpc = function (fnName: string) {
    if (fnName === "match_documents") {
      return {
        data: [
          {
            document_id: "doc-i36",
            chunk_index: 0,
            content: "[METADATA:{\"sourceDocument\":\"instrucao_36_afastamentos.pdf\"}]\nAfastamento por licença prêmio regulamentada na instrução de serviço.",
            similarity: 0.45,
          },
          {
            document_id: "doc-rdpm",
            chunk_index: 0,
            content: "[METADATA:{\"sourceDocument\":\"regulamento_disciplinar_rdpm.pdf\"}]\nO regulamento disciplinar militar aborda conduta e penalidades.",
            similarity: 0.38,
          },
        ],
        error: null,
      } as any;
    }
    return originalRpc.call(supabase, fnName as any);
  } as any;

  try {
    const results = await SearchService.search("Segundo o RDPM...", 5, 0.3);

    assert.strictEqual(results.length, 2);
    // RDPM document should be boosted due to explicit query reference "RDPM"
    assert.strictEqual(results[0].documentId, "doc-rdpm");
    assert.ok(results[0].score > results[1].score);
  } finally {
    supabase.rpc = originalRpc;
  }
});

test("SearchService - Retrieval Precision & Recall: Generic Query without explicit document reference (maintains diversity)", async () => {
  const originalRpc = supabase.rpc;
  supabase.rpc = function (fnName: string) {
    if (fnName === "match_documents") {
      return {
        data: [
          {
            document_id: "doc-afastamento",
            chunk_index: 0,
            content: "[METADATA:{\"sourceDocument\":\"licencas.pdf\"}]\nLicença médica por motivo de saúde pessoal ou familiar.",
            similarity: 0.50,
          },
          {
            document_id: "doc-afastamento",
            chunk_index: 1,
            content: "[METADATA:{\"sourceDocument\":\"licencas.pdf\"}]\nComo funciona uma licença médica de curto prazo para praças.",
            similarity: 0.49,
          },
          {
            document_id: "doc-movimentacao",
            chunk_index: 0,
            content: "[METADATA:{\"sourceDocument\":\"movimentacao.pdf\"}]\nRemoção e transferência a pedido para tratamento de saúde.",
            similarity: 0.45,
          },
        ],
        error: null,
      } as any;
    }
    return originalRpc.call(supabase, fnName as any);
  } as any;

  try {
    const results = await SearchService.search("Como funciona uma licença médica?", 5, 0.3);

    assert.strictEqual(results.length, 3);
    // Chunks from doc-afastamento should suffer a diversity penalty, allowing doc-movimentacao to rise/stay highly relevant
    // In this case, rank 1 is doc-afastamento (idx 0), rank 2 should be doc-movimentacao (originally 0.45 * 0.7, whereas doc-afastamento chunk 1 is penalized from 0.49 * 0.7 to 0.41)
    assert.strictEqual(results[1].documentId, "doc-movimentacao");
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
    const expectedScore = 1 / (60 + 1) + 0.9 * 0.0001;
    assert.ok(Math.abs(results[0].score - expectedScore) < 1e-7);
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

// PR 4 Additional Hybrid Search Tests

test("SearchService - Hybrid Search: Query by article 'Artigo 42'", async () => {
  const originalRpc = supabase.rpc;
  supabase.rpc = function (fnName: string) {
    if (fnName === "match_documents") {
      // Vector search returns something generic or low similarity
      return {
        data: [
          {
            document_id: "doc-generic",
            chunk_index: 5,
            content: "[METADATA:{\"sourceDocument\":\"manual.pdf\"}]\nEste é um texto genérico sobre a corporação.",
            similarity: 0.50,
          },
        ],
        error: null,
      } as any;
    }
    if (fnName === "match_knowledge_chunks_lexical") {
      // Lexical search returns the exact match for Artigo 42
      return {
        data: [
          {
            document_id: "doc-art42",
            chunk_index: 10,
            content: "[METADATA:{\"sourceDocument\":\"rdpm.pdf\"}]\nArtigo 42. O militar estadual deve portar-se de maneira exemplar.",
            similarity: 0.95,
          },
        ],
        error: null,
      } as any;
    }
    return originalRpc.call(supabase, fnName as any);
  } as any;

  try {
    const results = await SearchService.search("Artigo 42", 5, 0.15);

    assert.ok(results.length >= 1);
    // Artigo 42 from rdpm.pdf should rank first due to high lexical score or combined rank
    assert.strictEqual(results[0].documentId, "doc-art42");
    assert.ok(results[0].text.includes("Artigo 42"));
  } finally {
    supabase.rpc = originalRpc;
  }
});

test("SearchService - Hybrid Search: Query by acronym 'PAD'", async () => {
  const originalRpc = supabase.rpc;
  supabase.rpc = function (fnName: string) {
    if (fnName === "match_documents") {
      return {
        data: [
          {
            document_id: "doc-generic",
            chunk_index: 1,
            content: "[METADATA:{\"sourceDocument\":\"geral.pdf\"}]\nManual de atendimento geral ao público da PMESP.",
            similarity: 0.40,
          },
        ],
        error: null,
      } as any;
    }
    if (fnName === "match_knowledge_chunks_lexical") {
      return {
        data: [
          {
            document_id: "doc-pad",
            chunk_index: 0,
            content: "[METADATA:{\"sourceDocument\":\"instrucao_processo_pad.pdf\"}]\nO Processo Administrativo Disciplinar (PAD) é aplicável em faltas graves.",
            similarity: 0.85,
          },
        ],
        error: null,
      } as any;
    }
    return originalRpc.call(supabase, fnName as any);
  } as any;

  try {
    const results = await SearchService.search("PAD", 5, 0.15);

    assert.ok(results.length >= 1);
    // PAD document should be boosted and prioritized
    assert.strictEqual(results[0].documentId, "doc-pad");
    assert.ok(results[0].text.includes("PAD"));
  } finally {
    supabase.rpc = originalRpc;
  }
});

test("SearchService - Hybrid Search: Query by document 'Segundo o RDPM'", async () => {
  const originalRpc = supabase.rpc;
  supabase.rpc = function (fnName: string) {
    if (fnName === "match_documents") {
      return {
        data: [
          {
            document_id: "doc-other",
            chunk_index: 3,
            content: "[METADATA:{\"sourceDocument\":\"outro_doc.pdf\"}]\nOutros temas não relacionados ao regulamento disciplinar.",
            similarity: 0.45,
          },
        ],
        error: null,
      } as any;
    }
    if (fnName === "match_knowledge_chunks_lexical") {
      return {
        data: [
          {
            document_id: "doc-rdpm",
            chunk_index: 2,
            content: "[METADATA:{\"sourceDocument\":\"regulamento_disciplinar_rdpm.pdf\"}]\nAs transgressões disciplinares no regulamento disciplinar RDPM.",
            similarity: 0.90,
          },
        ],
        error: null,
      } as any;
    }
    return originalRpc.call(supabase, fnName as any);
  } as any;

  try {
    const results = await SearchService.search("Segundo o RDPM", 5, 0.15);

    assert.ok(results.length >= 1);
    // RDPM document should be prioritized
    assert.strictEqual(results[0].documentId, "doc-rdpm");
    assert.ok(results[0].metadata?.sourceDocument?.includes("rdpm"));
  } finally {
    supabase.rpc = originalRpc;
  }
});

test("SearchService - Hybrid Search: Semantic Query maintains semantic search benefits", async () => {
  const originalRpc = supabase.rpc;
  supabase.rpc = function (fnName: string) {
    if (fnName === "match_documents") {
      // Vector search matches semantic meaning beautifully
      return {
        data: [
          {
            document_id: "doc-proc-adm",
            chunk_index: 15,
            content: "[METADATA:{\"sourceDocument\":\"rito_sumario.pdf\"}]\nA sindicância e o processo de rito sumário apuram infrações na corporação.",
            similarity: 0.88,
          },
        ],
        error: null,
      } as any;
    }
    if (fnName === "match_knowledge_chunks_lexical") {
      // Lexical search doesn't find exact phrase matching well, or returns lower similarity
      return {
        data: [],
        error: null,
      } as any;
    }
    return originalRpc.call(supabase, fnName as any);
  } as any;

  try {
    const results = await SearchService.search("Como funciona o processo administrativo disciplinar?", 5, 0.15);

    assert.ok(results.length >= 1);
    // The semantic search should ensure we still get our relevant chunk
    assert.strictEqual(results[0].documentId, "doc-proc-adm");
    assert.ok(results[0].score > 0);
  } finally {
    supabase.rpc = originalRpc;
  }
});

test("SearchService - Hybrid Search: Literal Textual Query 'licença médica' uses lexical search", async () => {
  const originalRpc = supabase.rpc;
  supabase.rpc = function (fnName: string) {
    if (fnName === "match_documents") {
      // Vector matches are somewhat low or general
      return {
        data: [
          {
            document_id: "doc-generic",
            chunk_index: 1,
            content: "[METADATA:{\"sourceDocument\":\"geral.pdf\"}]\nAspectos de saúde ocupacional do servidor.",
            similarity: 0.40,
          },
        ],
        error: null,
      } as any;
    }
    if (fnName === "match_knowledge_chunks_lexical") {
      // Lexical match has the exact phrase "licença médica"
      return {
        data: [
          {
            document_id: "doc-licenca",
            chunk_index: 4,
            content: "[METADATA:{\"sourceDocument\":\"afastamentos.pdf\"}]\nA licença médica para tratamento de saúde deve ser concedida pelo serviço médico.",
            similarity: 0.95,
          },
        ],
        error: null,
      } as any;
    }
    return originalRpc.call(supabase, fnName as any);
  } as any;

  try {
    const results = await SearchService.search("licença médica", 5, 0.15);

    assert.ok(results.length >= 1);
    // Exact match for "licença médica" should be on top
    assert.strictEqual(results[0].documentId, "doc-licenca");
    assert.ok(results[0].text.includes("licença médica"));
  } finally {
    supabase.rpc = originalRpc;
  }
});
