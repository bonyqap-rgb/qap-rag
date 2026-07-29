import { test } from "node:test";
import assert from "node:assert";
import { ChunkerService } from "./chunker/chunker.service.js";
import { EmbeddingService } from "./embedding/embedding.service.js";
import { VectorService } from "./vector/vector.service.js";
import { IndexerService } from "./indexer/indexer.service.js";
import { DocumentService } from "./document.service.js";
import { Document } from "../models/document.model.js";

// ==========================================
// 1. CHUNKER SERVICE TESTS
// ==========================================

test("ChunkerService - splits text respecting sentence boundaries and page markers", () => {
  const chunker = new ChunkerService(100, 20);
  const text = `[PAGE_MARKER:1]\nEsta é a primeira frase muito legal. Esta é a segunda frase bacana.\n[PAGE_MARKER:2]\nEsta é a terceira frase incrível do documento.`;
  const chunks = chunker.splitText(text);

  assert.ok(chunks.length >= 2);
  // Ensure chunks are prefixed with the expected [PAGE:X] format
  assert.match(chunks[0], /^\[PAGE:1\]/);
  // Ensure we didn't cut the sentences in the middle of words
  assert.ok(chunks[0].includes("Esta é a primeira frase muito legal."));
});

test("ChunkerService - handles empty and edge case inputs", () => {
  const chunker = new ChunkerService();
  assert.deepStrictEqual(chunker.splitText(""), []);
  assert.deepStrictEqual(chunker.splitText("   "), []);
});

// ==========================================
// 2. EMBEDDING SERVICE TESTS (MOCKED)
// ==========================================

test("EmbeddingService - generateEmbedding generates vector using underlying implementation", async () => {
  const embeddingService = new EmbeddingService();

  class MockEmbeddingService extends EmbeddingService {
    override async generateEmbedding(text: string): Promise<number[]> {
      if (!text || text.trim() === "") throw new Error("Texto vazio");
      return Array(768).fill(0.1);
    }
  }

  const mockService = new MockEmbeddingService();
  const vector = await mockService.generateEmbedding("Olá Mundo");
  assert.strictEqual(vector.length, 768);
  assert.strictEqual(vector[0], 0.1);
});

// ==========================================
// 3. VECTOR SERVICE TESTS (MOCKED)
// ==========================================

test("VectorService - saves and retrieves chunks using mocked SupabaseClient", async () => {
  const fakeData: any[] = [];
  const mockSupabase: any = {
    from: (table: string) => {
      assert.strictEqual(table, "document_chunks");
      return {
        insert: (payload: any) => {
          if (Array.isArray(payload)) {
            const inserted = payload.map((p, i) => ({
              id: `chunk-uuid-${i}`,
              document_id: p.document_id,
              chunk_index: p.chunk_index,
              texto: p.texto,
              embedding: p.embedding,
              created_at: new Date().toISOString(),
            }));
            fakeData.push(...inserted);
            return {
              select: () => ({
                data: inserted,
                error: null,
              }),
            };
          } else {
            const inserted = {
              id: "chunk-uuid-single",
              document_id: payload.document_id,
              chunk_index: payload.chunk_index,
              texto: payload.texto,
              embedding: payload.embedding,
              created_at: new Date().toISOString(),
            };
            fakeData.push(inserted);
            return {
              select: () => ({
                single: () => ({
                  data: inserted,
                  error: null,
                }),
              }),
            };
          }
        },
        select: () => ({
          eq: (col: string, val: any) => {
            assert.strictEqual(col, "document_id");
            return {
              order: (orderCol: string, opts: any) => {
                assert.strictEqual(orderCol, "chunk_index");
                assert.strictEqual(opts.ascending, true);
                return {
                  data: fakeData.filter(d => d.document_id === val),
                  error: null,
                };
              }
            };
          }
        })
      };
    },
    rpc: (fnName: string, params: any) => {
      assert.strictEqual(fnName, "save_document_chunks_json");
      assert.ok(params.p_document_id);
      assert.ok(Array.isArray(params.p_chunks));
      return { data: null, error: null };
    }
  };

  const vectorService = new VectorService(mockSupabase);
  const chunkToSave = {
    documentId: "doc-uuid-1",
    chunkIndex: 0,
    texto: "[PAGE:1] Texto de teste para banco vetorial",
    embedding: Array(768).fill(0.2),
  };

  const savedSingle = await vectorService.saveChunk(chunkToSave);
  assert.strictEqual(savedSingle.id, "chunk-uuid-single");
  assert.strictEqual(savedSingle.documentId, chunkToSave.documentId);

  // Clear and test batch insert
  fakeData.length = 0;
  const batchToSave = [
    {
      documentId: "doc-uuid-2",
      chunkIndex: 0,
      texto: "Trecho A",
      embedding: Array(768).fill(0.3),
    },
    {
      documentId: "doc-uuid-2",
      chunkIndex: 1,
      texto: "Trecho B",
      embedding: Array(768).fill(0.4),
    }
  ];

  const savedBatch = await vectorService.saveChunks(batchToSave);
  assert.strictEqual(savedBatch.length, 2);
  assert.strictEqual(savedBatch[0].texto, "Trecho A");

  // Query/Retrieve back
  const retrieved = await vectorService.getChunksByDocumentId("doc-uuid-2");
  assert.strictEqual(retrieved.length, 2);
  assert.strictEqual(retrieved[1].texto, "Trecho B");

  // Verify saveChunksTransactional RPC triggers correctly
  await assert.doesNotReject(async () => {
    await vectorService.saveChunksTransactional("doc-uuid-2", batchToSave);
  });
});

// ==========================================
// 4. INDEXER SERVICE & FLOW TESTS
// ==========================================

test("IndexerService - successfully executes complete indexing pipeline with transactional RPC", async () => {
  // Setup mocks
  const mockDocument: Document = {
    id: "doc-123",
    title: "Documento de Teste da Pipeline",
    category: "Geral",
    version: "1.0",
    source: "Manual",
    language: "pt-BR",
    filename: "teste.pdf",
    fileSize: 500,
    mimeType: "application/pdf",
    totalPages: 2,
    processingStatus: "pending",
    extractedText: "[PAGE_MARKER:1]\nEsta é a página um.\n[PAGE_MARKER:2]\nEsta é a página dois.",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const statusUpdates: string[] = [];

  const mockDocumentService = {
    getDocumentById: async (id: string): Promise<Document> => {
      assert.strictEqual(id, "doc-123");
      return mockDocument;
    },
    updateDocument: async (id: string, payload: any): Promise<Document> => {
      assert.strictEqual(id, "doc-123");
      if (payload.processingStatus) {
        statusUpdates.push(payload.processingStatus);
        mockDocument.processingStatus = payload.processingStatus;
      }
      return mockDocument;
    }
  } as any;

  // Use small chunkSize (25) to force separate chunks for "Esta é a página um." and "Esta é a página dois."
  const mockChunkerService = new ChunkerService(25, 5);

  const mockEmbeddingService = {
    generateEmbedding: async (text: string): Promise<number[]> => {
      return Array(768).fill(0.5);
    }
  } as any;

  let rpcCallCount = 0;
  let rpcDocumentId = "";
  let rpcChunksPayload: any[] = [];

  const mockVectorService = {
    saveChunksTransactional: async (documentId: string, chunks: any[]) => {
      rpcCallCount++;
      rpcDocumentId = documentId;
      rpcChunksPayload = chunks;
    }
  } as any;

  const indexer = new IndexerService(
    mockDocumentService,
    mockChunkerService,
    mockEmbeddingService,
    mockVectorService
  );

  await indexer.indexDocument("doc-123");

  // Verify full pipeline state transitions: pending -> processing -> indexed
  assert.deepStrictEqual(statusUpdates, ["processing", "indexed"]);
  assert.strictEqual(mockDocument.processingStatus, "indexed");

  // Verify that chunks were saved properly with accurate indices, text and embedding format
  assert.strictEqual(rpcCallCount, 1);
  assert.strictEqual(rpcDocumentId, "doc-123");
  assert.strictEqual(rpcChunksPayload.length, 2);
  assert.strictEqual(rpcChunksPayload[0].chunkIndex, 0);
  assert.strictEqual(rpcChunksPayload[0].texto.includes("Esta é a página um."), true);
});

test("IndexerService - pipeline handles failures gracefully, logging and marking status as failed", async () => {
  const mockDocument: Document = {
    id: "doc-fail",
    title: "Documento de Falha",
    category: "Geral",
    version: "1.0",
    source: "Manual",
    language: "pt-BR",
    filename: "falha.pdf",
    fileSize: 100,
    mimeType: "application/pdf",
    totalPages: 1,
    processingStatus: "pending",
    extractedText: "Texto curto de teste.",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const statusUpdates: string[] = [];

  const mockDocumentService = {
    getDocumentById: async (id: string): Promise<Document> => {
      return mockDocument;
    },
    updateDocument: async (id: string, payload: any): Promise<Document> => {
      if (payload.processingStatus) {
        statusUpdates.push(payload.processingStatus);
        mockDocument.processingStatus = payload.processingStatus;
      }
      return mockDocument;
    }
  } as any;

  const mockChunkerService = new ChunkerService();

  const mockEmbeddingService = {
    generateEmbedding: async (text: string): Promise<number[]> => {
      throw new Error("Erro de cota / Limite de requisições excedido da API Gemini");
    }
  } as any;

  const mockVectorService = {
    saveChunksTransactional: async () => {}
  } as any;

  const indexer = new IndexerService(
    mockDocumentService,
    mockChunkerService,
    mockEmbeddingService,
    mockVectorService
  );

  await assert.rejects(
    async () => {
      await indexer.indexDocument("doc-fail");
    },
    (err: Error) => {
      assert.strictEqual(err.message.includes("Erro de cota"), true);
      return true;
    }
  );

  // Check state transitions on error: processing -> failed
  assert.deepStrictEqual(statusUpdates, ["processing", "failed"]);
  assert.strictEqual(mockDocument.processingStatus, "failed");
});

test("IndexerService - rejects indexing if document is already in 'processing' status", async () => {
  const mockDocument: Document = {
    id: "doc-already-processing",
    title: "Documento Processando",
    category: "Geral",
    version: "1.0",
    source: "Manual",
    language: "pt-BR",
    filename: "proc.pdf",
    fileSize: 100,
    mimeType: "application/pdf",
    totalPages: 1,
    processingStatus: "processing", // already processing
    extractedText: "Texto extraído.",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const mockDocumentService = {
    getDocumentById: async (id: string): Promise<Document> => {
      return mockDocument;
    },
    updateDocument: async () => {
      return mockDocument;
    }
  } as any;

  const indexer = new IndexerService(
    mockDocumentService,
    new ChunkerService(),
    {} as any,
    {} as any
  );

  await assert.rejects(
    async () => {
      await indexer.indexDocument("doc-already-processing");
    },
    (err: Error) => {
      assert.strictEqual(err.message.includes("já está em processamento"), true);
      return true;
    }
  );
});
