import { test } from "node:test";
import assert from "node:assert";
import { env } from "../config/env.js";
import { supabase } from "../config/supabase.js";
import { inspectDocument } from "./inspect-rag.js";

test("inspect-rag - successfully inspects CPM and RDPM via mock queries", async () => {
  // Save original env key and supabase.from function
  const originalKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const originalFrom = supabase.from;

  // Set to a mock non-dummy key to satisfy the validation
  env.SUPABASE_SERVICE_ROLE_KEY = "real-service-role-key-for-testing";

  // Mock supabase.from
  supabase.from = function (table: string) {
    if (table === "knowledge_documents") {
      return {
        select: () => Promise.resolve({
          data: [
            {
              id: "mock-cpm-uuid",
              file_name: "codigo_penal_militar.pdf",
              extracted_chars: 120000,
              total_chunks: 100,
              total_embeddings: 100
            },
            {
              id: "mock-rdpm-uuid",
              file_name: "regulamento_disciplinar_rdpm.pdf",
              extracted_chars: 60000,
              total_chunks: 50,
              total_embeddings: 50
            }
          ],
          error: null
        })
      } as any;
    }

    if (table === "knowledge_chunks") {
      return {
        select: () => ({
          eq: (field: string, val: any) => ({
            order: (orderField: string, options: any) => {
              const isCPM = val === "mock-cpm-uuid";
              let chunks = [];
              if (isCPM) {
                chunks = [
                  {
                    id: "chunk-cpm-1",
                    document_id: val,
                    chunk_index: 0,
                    content: '[METADATA:{"sourceDocument":"codigo_penal_militar.pdf","pageNumber":1}]\nArtigo 1. Este é o Código Penal Militar.'
                  },
                  {
                    id: "chunk-cpm-2",
                    document_id: val,
                    chunk_index: 10,
                    content: '[METADATA:{"sourceDocument":"codigo_penal_militar.pdf","pageNumber":5}]\nArtigo 187. Deserção: Consiste em o militar ausentar-se, sem licença, da unidade em que serve.'
                  },
                  {
                    id: "chunk-cpm-3",
                    document_id: val,
                    chunk_index: 20,
                    content: '[METADATA:{"sourceDocument":"codigo_penal_militar.pdf","pageNumber":12}]\nAbandono de posto é considerado crime contra o serviço militar.'
                  }
                ];
              } else {
                chunks = [
                  {
                    id: "chunk-rdpm-1",
                    document_id: val,
                    chunk_index: 0,
                    content: '[METADATA:{"sourceDocument":"regulamento_disciplinar_rdpm.pdf","pageNumber":1}]\nArtigo 1. Regulamento Disciplinar da PM.'
                  },
                  {
                    id: "chunk-rdpm-2",
                    document_id: val,
                    chunk_index: 15,
                    content: '[METADATA:{"sourceDocument":"regulamento_disciplinar_rdpm.pdf","pageNumber":8}]\nArtigo 53. Transgressão disciplinar gravíssima sujeita a processo administrativo disciplinar de demissão.'
                  },
                  {
                    id: "chunk-rdpm-3",
                    document_id: val,
                    chunk_index: 30,
                    content: '[METADATA:{"sourceDocument":"regulamento_disciplinar_rdpm.pdf","pageNumber":14}]\nInstaurar sindicância para apurar a autoria do fato ocorrido.'
                  }
                ];
              }
              return Promise.resolve({ data: chunks, error: null });
            }
          })
        })
      } as any;
    }

    return originalFrom.call(supabase, table);
  };

  try {
    // Test CPM
    const cpmResult = await inspectDocument("Código Penal Militar");
    assert.ok(cpmResult);
    assert.strictEqual(cpmResult.documentName, "codigo_penal_militar.pdf");
    assert.strictEqual(cpmResult.totalPages, 12);
    assert.strictEqual(cpmResult.extractedChars, 120000);

    const desercaoRes = cpmResult.searchResults.find(r => r.term === "deserção");
    assert.ok(desercaoRes);
    assert.strictEqual(desercaoRes.found, true);
    assert.strictEqual(desercaoRes.page, 5);

    // Test RDPM
    const rdpmResult = await inspectDocument("RDPM");
    assert.ok(rdpmResult);
    assert.strictEqual(rdpmResult.documentName, "regulamento_disciplinar_rdpm.pdf");
    assert.strictEqual(rdpmResult.totalPages, 14);

    const sindicanciaRes = rdpmResult.searchResults.find(r => r.term === "sindicância");
    assert.ok(sindicanciaRes);
    assert.strictEqual(sindicanciaRes.found, true);
    assert.strictEqual(sindicanciaRes.page, 14);

    // Test Unmatched
    const nullResult = await inspectDocument("Inexistente");
    assert.strictEqual(nullResult, null);

  } finally {
    // Restore original values
    env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
    supabase.from = originalFrom;
  }
});

test("inspect-rag - throws error when service role key is dummy_key", async () => {
  const originalKey = env.SUPABASE_SERVICE_ROLE_KEY;
  env.SUPABASE_SERVICE_ROLE_KEY = "dummy_key";

  try {
    await assert.rejects(
      () => inspectDocument("CPM"),
      /Erro: Chave de API do Supabase não configurada ou inválida/
    );
  } finally {
    env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  }
});
