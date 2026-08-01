process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy_key";
process.env.GROQ_API_KEY = "dummy_key";
import { test, after } from "node:test";
import assert from "node:assert";
import express from "express";
import { Server } from "http";
import { supabase } from "../config/supabase.js";
import documentsRouter, { documentService } from "./documents.js";
import metricsRouter from "./metrics.js";
import { indexingHistoryService } from "../services/indexing-history.service.js";
import { metricsService } from "../services/metrics.service.js";
import { errorHandler } from "../middlewares/error.middleware.js";

import { setEmbeddingImplementation, resetEmbeddingImplementation } from "../groq/embed.js";

// Stub the embedding implementation directly for consistent and fast mock vectors
setEmbeddingImplementation(async (text) => {
  return Array(1536).fill(0.1);
});

// Setup mock express server
const app = express();
app.use(express.json());
app.use("/documents", documentsRouter);
app.use("/metrics", metricsRouter);

// Administrative HTML page mockup
app.get("/admin", (_, res) => {
  res.send("HTML Dashboard");
});

// Administrative reindex-all endpoint mockup
app.post("/admin/reindex-all", async (req, res, next) => {
  const adminKey = req.headers["x-admin-key"] || req.headers["authorization"]?.replace("Bearer ", "");
  if (!adminKey || adminKey !== "dummy_key") {
    return res.status(401).json({
      error: "UNAUTHORIZED",
      message: "Acesso administrativo não autorizado."
    });
  }

  try {
    const result = await documentService.reindexAllCompletedDocuments();
    return res.status(200).json({
      success: result.success,
      documentsProcessed: result.documentsProcessed,
      chunksProcessed: result.chunksProcessed,
      durationMs: result.durationMs,
      errors: result.errors
    });
  } catch (error) {
    next(error);
  }
});

app.use(errorHandler);

const server: Server = app.listen(0);
const address = server.address();
const port = typeof address === "string" ? 0 : address?.port;

const docUrl = `http://localhost:${port}/documents`;
const metricsUrl = `http://localhost:${port}/metrics`;
const adminUrl = `http://localhost:${port}/admin`;

after(() => {
  server.close();
});

test("API GET /metrics - returns current metrics and count of indexed documents", async () => {
  metricsService.reset();
  metricsService.incrementRequests();

  // Stub supabase select count
  const originalFrom = supabase.from;
  supabase.from = function (table: string) {
    if (table === "knowledge_documents") {
      const queryBuilder = {
        select: (fields: string, opts: any) => {
          return Promise.resolve({ count: 42, error: null });
        }
      };
      return queryBuilder as any;
    }
    return originalFrom.call(supabase, table);
  };

  try {
    const res = await fetch(metricsUrl);
    assert.strictEqual(res.status, 200);
    const body = await res.json() as any;

    assert.strictEqual(body.numero_total_requisicoes, 1);
    assert.strictEqual(body.quantidade_documentos_indexados, 42);
    assert.strictEqual(body.versao, "1.0.0");
  } finally {
    supabase.from = originalFrom;
  }
});

test("API GET /documents/stats - returns knowledge base stats", async () => {
  const originalStats = documentService.getKnowledgeBaseStats;
  const mockStats = {
    total_documentos: 10,
    documentos_indexados: 8,
    documentos_pendentes: 2,
    total_chunks: 120,
    media_chunks_por_documento: 12,
    tamanho_medio_chunks: 250,
    data_ultima_indexacao: "2023-10-10T12:00:00Z",
    quantidade_vetores_armazenados: 120
  };

  documentService.getKnowledgeBaseStats = async () => mockStats;

  try {
    const res = await fetch(`${docUrl}/stats`);
    assert.strictEqual(res.status, 200);
    const body = await res.json() as any;

    assert.deepStrictEqual(body, mockStats);
  } finally {
    documentService.getKnowledgeBaseStats = originalStats;
  }
});

test("API GET /documents/history - returns indexing history", async () => {
  const originalHistory = indexingHistoryService.getHistory;
  const mockHistory = [
    {
      id: "hist-123",
      document: "manual.pdf",
      date: "2023-10-10T12:00:00Z",
      duration: 1500,
      chunks_count: 10,
      embeddings_count: 10,
      success: true
    }
  ];

  indexingHistoryService.getHistory = async () => mockHistory;

  try {
    const res = await fetch(`${docUrl}/history`);
    assert.strictEqual(res.status, 200);
    const body = await res.json() as any;

    assert.deepStrictEqual(body, mockHistory);
  } finally {
    indexingHistoryService.getHistory = originalHistory;
  }
});

test("API POST /documents/:id/reindex - reindexes a document successfully executing actual service logic", async () => {
  // Stub repository and supabase calls to let the service reindex logic run
  const originalGetById = (documentService as any).repository.getById;
  const originalUpdate = (documentService as any).repository.update;
  const originalFrom = supabase.from;
  const originalRpc = supabase.rpc;

  // Mock metadata document
  (documentService as any).repository.getById = async (id: string) => ({
    id,
    title: "Documento de Teste",
    category: "Segurança",
    version: "1.0.0",
    source: "Manual PM",
    language: "pt-BR",
    filename: "manual_pm.pdf",
    fileSize: 102400,
    mimeType: "application/pdf",
    totalPages: 15,
    processingStatus: "completed"
  });

  // Mock repository update
  (documentService as any).repository.update = async (id: string, updatePayload: any) => ({
    id,
    title: "Documento de Teste",
    category: "Segurança",
    version: "1.0.0",
    source: "Manual PM",
    language: "pt-BR",
    filename: "manual_pm.pdf",
    fileSize: 102400,
    mimeType: "application/pdf",
    totalPages: 15,
    processingStatus: updatePayload.processing_status || "completed"
  });

  // Mock supabase from queries
  supabase.from = function (table: string) {
    const queryBuilder = {
      select: (fields: string) => queryBuilder,
      eq: (col: string, val: string) => queryBuilder,
      order: (col: string, opts: any) => queryBuilder,
      update: (payload: any) => queryBuilder,
      insert: (payload: any) => queryBuilder,
      maybeSingle: () => {
        if (table === "knowledge_documents") {
          return Promise.resolve({ data: { id: "k-doc-uuid" }, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      then: (resolve: any) => {
        if (table === "knowledge_chunks") {
          resolve({
            data: [
              { chunk_index: 0, content: "[METADATA:{\"source\":\"manual_pm.pdf\"}]\nEste é um trecho de teste." }
            ],
            error: null
          });
        } else if (table === "knowledge_documents") {
          resolve({ data: { id: "k-doc-uuid" }, error: null });
        } else {
          resolve({ data: [], error: null });
        }
      }
    };
    return queryBuilder as any;
  };

  // Mock supabase update_document_chunks_transaction rpc
  supabase.rpc = function (fnName: string, args: any) {
    if (fnName === "update_document_chunks_transaction") {
      return Promise.resolve({ data: null, error: null }) as any;
    }
    return originalRpc.call(supabase, fnName as any, args);
  } as any;

  try {
    const res = await fetch(`${docUrl}/doc-uuid-123/reindex`, {
      method: "POST"
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json() as any;

    assert.strictEqual(body.success, true);
    assert.strictEqual(body.chunksCount, 1);
  } finally {
    (documentService as any).repository.getById = originalGetById;
    (documentService as any).repository.update = originalUpdate;
    supabase.from = originalFrom;
    supabase.rpc = originalRpc;
  }
});

test("API DELETE /documents/:id - deletes document safely", async () => {
  const originalDelete = documentService.deleteDocument;
  let deletedId = "";
  documentService.deleteDocument = async (id: string) => {
    deletedId = id;
  };

  try {
    const res = await fetch(`${docUrl}/doc-uuid-123`, {
      method: "DELETE"
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json() as any;

    assert.strictEqual(body.success, true);
    assert.strictEqual(deletedId, "doc-uuid-123");
  } finally {
    documentService.deleteDocument = originalDelete;
  }
});

test("API POST /documents/reindex-all - rejects request with 401 if unauthorized", async () => {
  const res = await fetch(`${docUrl}/reindex-all`, {
    method: "POST"
  });
  assert.strictEqual(res.status, 401);
  const body = await res.json() as any;
  assert.strictEqual(body.error, "UNAUTHORIZED");
});

test("API POST /documents/reindex-all - reindexes all completed documents when authorized", async () => {
  const originalList = documentService.listDocuments;
  const originalListK = documentService.listKnowledgeDocuments;
  const originalReindex = documentService.reindexDocument;

  const mockDocs = [
    {
      id: "doc-1",
      title: "Doc 1",
      category: "Segurança",
      version: "1.0.0",
      source: "Manual",
      language: "pt-BR",
      filename: "doc1.pdf",
      fileSize: 100,
      mimeType: "application/pdf",
      totalPages: 1,
      processingStatus: "completed" as const
    },
    {
      id: "doc-2",
      title: "Doc 2",
      category: "Segurança",
      version: "1.0.0",
      source: "Manual",
      language: "pt-BR",
      filename: "doc2.pdf",
      fileSize: 100,
      mimeType: "application/pdf",
      totalPages: 1,
      processingStatus: "pending" as const
    }
  ];

  const reindexedIds: string[] = [];

  documentService.listDocuments = async () => mockDocs as any;
  documentService.listKnowledgeDocuments = async () => mockDocs.filter(d => d.processingStatus === "completed").map(d => ({ id: d.id, file_name: d.filename }));
  documentService.reindexDocument = async (id: string) => {
    reindexedIds.push(id);
    return {
      success: true,
      chunksCount: 5,
      durationMs: 120
    };
  };

  try {
    const res = await fetch(`${docUrl}/reindex-all`, {
      method: "POST",
      headers: {
        "x-admin-key": "dummy_key"
      }
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json() as any;

    assert.strictEqual(body.success, true);
    assert.strictEqual(body.documentsProcessed, 1);
    assert.strictEqual(body.chunksProcessed, 5);
    assert.deepStrictEqual(reindexedIds, ["doc-1"]);
  } finally {
    documentService.listDocuments = originalList;
    documentService.listKnowledgeDocuments = originalListK;
    documentService.reindexDocument = originalReindex;
  }
});

test("API GET /admin - renders admin dashboard page successfully", async () => {
  const res = await fetch(adminUrl);
  assert.strictEqual(res.status, 200);
  const text = await res.text();
  assert.match(text, /HTML Dashboard/);
});

test("API POST /admin/reindex-all - rejects unauthorized access", async () => {
  const res = await fetch(`${adminUrl}/reindex-all`, {
    method: "POST"
  });
  assert.strictEqual(res.status, 401);
});

test("API POST /admin/reindex-all - executes reindexing successfully when authorized", async () => {
  const originalList = documentService.listDocuments;
  const originalListK = documentService.listKnowledgeDocuments;
  const originalReindex = documentService.reindexDocument;

  const mockDocs = [
    {
      id: "doc-admin-1",
      title: "Doc Admin 1",
      category: "Segurança",
      version: "1.0.0",
      source: "Manual",
      language: "pt-BR",
      filename: "docadmin1.pdf",
      fileSize: 100,
      mimeType: "application/pdf",
      totalPages: 1,
      processingStatus: "completed" as const
    }
  ];

  const reindexedIds: string[] = [];

  documentService.listDocuments = async () => mockDocs as any;
  documentService.listKnowledgeDocuments = async () => mockDocs.map(d => ({ id: d.id, file_name: d.filename }));
  documentService.reindexDocument = async (id: string) => {
    reindexedIds.push(id);
    return {
      success: true,
      chunksCount: 10,
      durationMs: 150
    };
  };

  try {
    const res = await fetch(`${adminUrl}/reindex-all`, {
      method: "POST",
      headers: {
        "x-admin-key": "dummy_key"
      }
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json() as any;

    assert.strictEqual(body.success, true);
    assert.strictEqual(body.documentsProcessed, 1);
    assert.strictEqual(body.chunksProcessed, 10);
    assert.deepStrictEqual(reindexedIds, ["doc-admin-1"]);
  } finally {
    documentService.listDocuments = originalList;
    documentService.listKnowledgeDocuments = originalListK;
    documentService.reindexDocument = originalReindex;
  }
});
