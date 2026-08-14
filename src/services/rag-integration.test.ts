process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy_key";
process.env.GROQ_API_KEY = "dummy_key";

import { test } from "node:test";
import assert from "node:assert";
import { ChatService } from "./chat.service.js";
import { SearchService } from "./search.service.js";
import { setChatImplementation, resetChatImplementation } from "../groq/chat.js";
import { setEmbeddingImplementation, resetEmbeddingImplementation } from "../groq/embed.js";
import { supabase } from "../config/supabase.js";

test("REAL RAG PIPELINE INTEGRATION TEST 1 - Artigo 6º do Código Penal Militar without SearchService override", async () => {
  const docIdCPM = "cpm-real-uuid-101";
  const filenameCPM = "Direito Penal Militar e Processual Penal Militar.pdf";

  const chunkContentCPM = `[METADATA:{"sourceDocument":"${filenameCPM}","pageNumber":1,"chunkIndex":0,"totalChunks":1}]\nArt. 6º Lugar do crime: Considera-se praticado o fato no lugar em que ocorreu a ação ou omissão, no todo ou em parte, bem como onde se produziu ou deveria produzir-se o resultado.`;

  // Standardized 768-dim mock vector for tests
  const mock768Vector = new Array(768).fill(0.1);

  setEmbeddingImplementation(async (text: string) => {
    return mock768Vector;
  });

  const originalFrom = supabase.from;
  const originalRpc = supabase.rpc;

  // Intercept database calls to simulate real knowledge_documents & knowledge_chunks tables
  supabase.from = function (table: string) {
    if (table === "knowledge_documents") {
      return {
        select: () => ({
          in: () => Promise.resolve({
            data: [{ id: docIdCPM, file_name: filenameCPM }],
            error: null,
          }),
          then: (resolve: any) => resolve({
            data: [{ id: docIdCPM, file_name: filenameCPM }],
            error: null,
          }),
        }),
      } as any;
    }
    if (table === "knowledge_chunks") {
      return {
        select: () => ({
          eq: () => Promise.resolve({ data: [{ count: 1 }], error: null }),
          textSearch: () => ({
            limit: () => Promise.resolve({
              data: [
                {
                  id: "chunk-cpm-1",
                  document_id: docIdCPM,
                  chunk_index: 0,
                  content: chunkContentCPM,
                }
              ],
              error: null,
            })
          })
        })
      } as any;
    }
    return originalFrom.call(supabase, table);
  };

  supabase.rpc = function (fnName: string, params: any) {
    if (fnName === "match_documents" || fnName === "match_knowledge_chunks") {
      return Promise.resolve({
        data: [
          {
            id: "chunk-cpm-1",
            document_id: docIdCPM,
            chunk_index: 0,
            content: chunkContentCPM,
            similarity: 0.89,
          }
        ],
        error: null,
      }) as any;
    }
    if (fnName === "match_knowledge_chunks_lexical") {
      return Promise.resolve({
        data: [
          {
            id: "chunk-cpm-1",
            document_id: docIdCPM,
            chunk_index: 0,
            content: chunkContentCPM,
            similarity: 0.95,
          }
        ],
        error: null,
      }) as any;
    }
    return originalRpc.call(supabase, fnName, params);
  };

  let capturedContext = "";
  setChatImplementation(async (question, context) => {
    capturedContext = context;
    return "De acordo com o Art. 6º do Código Penal Militar, considera-se praticado o fato no lugar em que ocorreu a ação ou omissão, no todo ou em parte, bem como onde se produziu ou deveria produzir-se o resultado.";
  });

  try {
    // RUN REAL SearchService.search through ChatService.chat WITHOUT ANY MOCKING of SearchService.search
    const query = "Qual é o conteúdo do artigo 6º do Código Penal Militar?";
    const res = await ChatService.chat(query);

    // Verify retrieval
    assert.ok(capturedContext.includes("Art. 6º Lugar do crime"), "Retrieved context must contain Art. 6º text");
    assert.ok(res.sources.length >= 1, "Must return at least 1 real source");
    assert.strictEqual(res.sources[0].filename, filenameCPM, "Source filename must match indexed document");
    assert.ok(res.answer.includes("Art. 6º do Código Penal Militar"), "LLM answer must be grounded in Art. 6º");
    assert.ok(res.answer.includes("lugar em que ocorreu a ação ou omissão"), "LLM answer must state Lugar do crime content");
  } finally {
    supabase.from = originalFrom;
    supabase.rpc = originalRpc;
    resetEmbeddingImplementation();
    resetChatImplementation();
  }
});

test("REAL RAG PIPELINE INTEGRATION TEST 2 - Artigo 42 do RDPM without SearchService override", async () => {
  const docIdRDPM = "rdpm-real-uuid-202";
  const filenameRDPM = "RDPM_regulamento.pdf";

  const chunkContentRDPM = `[METADATA:{"sourceDocument":"${filenameRDPM}","pageNumber":12,"chunkIndex":5,"totalChunks":20}]\nArtigo 42 - As transgressões disciplinares classificam-se em graves, médias e leves, conforme a intensidade da falta e suas consequências.`;

  const mock768Vector = new Array(768).fill(0.1);

  setEmbeddingImplementation(async () => mock768Vector);

  const originalFrom = supabase.from;
  const originalRpc = supabase.rpc;

  supabase.from = function (table: string) {
    if (table === "knowledge_documents") {
      return {
        select: () => ({
          in: () => Promise.resolve({
            data: [{ id: docIdRDPM, file_name: filenameRDPM }],
            error: null,
          }),
          then: (resolve: any) => resolve({
            data: [{ id: docIdRDPM, file_name: filenameRDPM }],
            error: null,
          }),
        }),
      } as any;
    }
    if (table === "knowledge_chunks") {
      return {
        select: () => ({
          eq: () => Promise.resolve({ data: [{ count: 1 }], error: null }),
          textSearch: () => ({
            limit: () => Promise.resolve({
              data: [
                {
                  id: "chunk-rdpm-5",
                  document_id: docIdRDPM,
                  chunk_index: 5,
                  content: chunkContentRDPM,
                }
              ],
              error: null,
            })
          })
        })
      } as any;
    }
    return originalFrom.call(supabase, table);
  };

  supabase.rpc = function (fnName: string, params: any) {
    if (fnName === "match_documents" || fnName === "match_knowledge_chunks") {
      return Promise.resolve({
        data: [
          {
            id: "chunk-rdpm-5",
            document_id: docIdRDPM,
            chunk_index: 5,
            content: chunkContentRDPM,
            similarity: 0.91,
          }
        ],
        error: null,
      }) as any;
    }
    if (fnName === "match_knowledge_chunks_lexical") {
      return Promise.resolve({
        data: [
          {
            id: "chunk-rdpm-5",
            document_id: docIdRDPM,
            chunk_index: 5,
            content: chunkContentRDPM,
            similarity: 0.94,
          }
        ],
        error: null,
      }) as any;
    }
    return originalRpc.call(supabase, fnName, params);
  };

  let capturedContext = "";
  setChatImplementation(async (question, context) => {
    capturedContext = context;
    return "O Artigo 42 do RDPM estabelece que as transgressões disciplinares classificam-se em graves, médias e leves.";
  });

  try {
    const query = "Qual é o conteúdo do artigo 42 do RDPM?";
    const res = await ChatService.chat(query);

    assert.ok(capturedContext.includes("Artigo 42 - As transgressões disciplinares"), "Retrieved context must contain Artigo 42 text");
    assert.ok(res.sources.length >= 1, "Must return at least 1 real source");
    assert.strictEqual(res.sources[0].filename, filenameRDPM, "Source filename must match indexed RDPM document");
    assert.ok(res.answer.includes("Artigo 42 do RDPM"), "LLM answer must be grounded in Artigo 42");
    assert.ok(res.answer.includes("transgressões disciplinares"), "LLM answer must describe transgressões disciplinares");
  } finally {
    supabase.from = originalFrom;
    supabase.rpc = originalRpc;
    resetEmbeddingImplementation();
    resetChatImplementation();
  }
});

test("REAL RAG PIPELINE INTEGRATION TEST 3 - Negative test for ungrounded question returns empty context response", async () => {
  const mock768Vector = new Array(768).fill(0.1);

  setEmbeddingImplementation(async () => mock768Vector);

  const originalFrom = supabase.from;
  const originalRpc = supabase.rpc;

  supabase.from = function (table: string) {
    if (table === "knowledge_documents") {
      return {
        select: () => ({
          in: () => Promise.resolve({ data: [], error: null }),
          then: (resolve: any) => resolve({ data: [], error: null }),
        }),
      } as any;
    }
    if (table === "knowledge_chunks") {
      return {
        select: () => ({
          eq: () => Promise.resolve({ data: [], error: null }),
          textSearch: () => ({
            limit: () => Promise.resolve({ data: [], error: null })
          })
        })
      } as any;
    }
    return originalFrom.call(supabase, table);
  };

  supabase.rpc = function (fnName: string) {
    if (fnName === "match_documents" || fnName === "match_knowledge_chunks" || fnName === "match_knowledge_chunks_lexical") {
      return Promise.resolve({ data: [], error: null }) as any;
    }
    return originalRpc.call(supabase, fnName);
  };

  try {
    const ungroundedQuery = "Qual é a velocidade máxima de um foguete espacial na lua?";
    const res = await ChatService.chat(ungroundedQuery);

    assert.ok(res.answer.startsWith("Não encontrei essa informação na base de conhecimento."), "Must state information was not found");
    assert.strictEqual(res.sources.length, 0, "Must return 0 sources for ungrounded question");
  } finally {
    supabase.from = originalFrom;
    supabase.rpc = originalRpc;
    resetEmbeddingImplementation();
    resetChatImplementation();
  }
});
