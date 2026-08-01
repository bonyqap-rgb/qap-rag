process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy_key";
process.env.GROQ_API_KEY = "dummy_key";
import { test, after } from "node:test";
import assert from "node:assert";
import express from "express";
import { Server } from "http";
import documentsRouter, { documentService } from "./documents.js";
import { errorHandler } from "../middlewares/error.middleware.js";
import { Document } from "../models/document.model.js";
import { ValidationError, NotFoundError } from "../services/document.service.js";

// Initialize a clean test app
const app = express();
app.use(express.json());
app.use("/documents", documentsRouter);
app.use(errorHandler);

// Start on random port
const server: Server = app.listen(0);
const address = server.address();
const port = typeof address === "string" ? 0 : address?.port;

const baseUrl = `http://localhost:${port}/documents`;

// Helper to close server after all tests
after(() => {
  server.close();
});

const mockDoc: Document = {
  id: "8c77be02-4ee3-455b-80df-67993a4bc4d4",
  title: "Documento de Teste",
  category: "Segurança",
  version: "1.0.0",
  source: "Manual PM",
  language: "pt-BR",
  filename: "manual_pm.pdf",
  fileSize: 102400,
  mimeType: "application/pdf",
  totalPages: 15,
  processingStatus: "pending",
  createdAt: "2023-10-10T12:00:00Z",
  updatedAt: "2023-10-10T12:00:00Z"
};

test("API GET /documents/statistics - returns base statistics successfully", async () => {
  const originalGetStats = documentService.getKnowledgeBaseStatistics;
  const mockStats = {
    totalDocuments: 10,
    totalChunks: 100,
    totalSize: 50000,
    indexedDocuments: 10
  };
  documentService.getKnowledgeBaseStatistics = async () => mockStats;

  try {
    const res = await fetch(`${baseUrl}/statistics`);
    assert.strictEqual(res.status, 200);
    const body = await res.json() as any;
    assert.deepStrictEqual(body, mockStats);
  } finally {
    documentService.getKnowledgeBaseStatistics = originalGetStats;
  }
});

test("API GET /documents - returns list of documents", async () => {
  // Mock service
  const originalList = documentService.listDocuments;
  documentService.listDocuments = async () => [mockDoc];

  try {
    const res = await fetch(baseUrl);
    assert.strictEqual(res.status, 200);
    const body = await res.json() as Document[];
    assert.strictEqual(body.length, 1);
    assert.strictEqual(body[0].id, mockDoc.id);
    assert.strictEqual(body[0].title, mockDoc.title);
  } finally {
    documentService.listDocuments = originalList;
  }
});

test("API GET /documents/:id - returns document when found", async () => {
  // Mock service
  const originalGet = documentService.getDocumentById;
  documentService.getDocumentById = async (id: string) => ({ ...mockDoc, id });

  try {
    const res = await fetch(`${baseUrl}/${mockDoc.id}`);
    assert.strictEqual(res.status, 200);
    const body = await res.json() as Document;
    assert.strictEqual(body.id, mockDoc.id);
    assert.strictEqual(body.title, mockDoc.title);
  } finally {
    documentService.getDocumentById = originalGet;
  }
});

test("API GET /documents/:id - returns 404 when document not found", async () => {
  const originalGet = documentService.getDocumentById;
  documentService.getDocumentById = async (id: string) => {
    throw new NotFoundError(`Documento com ID '${id}' não encontrado.`);
  };

  try {
    const res = await fetch(`${baseUrl}/non-existent`);
    assert.strictEqual(res.status, 404);
    const body = await res.json() as any;
    assert.strictEqual(body.error, "ERROR");
    assert.strictEqual(body.message.includes("não encontrado"), true);
  } finally {
    documentService.getDocumentById = originalGet;
  }
});

test("API POST /documents - returns 201 and created document on success", async () => {
  const originalCreate = documentService.createDocument;
  documentService.createDocument = async (payload: any) => ({
    ...mockDoc,
    ...payload,
    id: "new-created-uuid"
  });

  const payload = {
    title: "Documento de Teste",
    category: "Segurança",
    version: "1.0.0",
    source: "Manual PM",
    language: "pt-BR",
    filename: "manual_pm.pdf",
    fileSize: 102400,
    mimeType: "application/pdf",
    totalPages: 15
  };

  try {
    const res = await fetch(baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    assert.strictEqual(res.status, 201);
    const body = await res.json() as Document;
    assert.strictEqual(body.id, "new-created-uuid");
    assert.strictEqual(body.title, payload.title);
  } finally {
    documentService.createDocument = originalCreate;
  }
});

test("API POST /documents - returns 400 when validation fails", async () => {
  const originalCreate = documentService.createDocument;
  documentService.createDocument = async () => {
    throw new ValidationError("O campo 'title' é obrigatório.");
  };

  try {
    const res = await fetch(baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });

    assert.strictEqual(res.status, 400);
    const body = await res.json() as any;
    assert.strictEqual(body.error, "ERROR");
    assert.strictEqual(body.message.includes("title' é obrigatório"), true);
  } finally {
    documentService.createDocument = originalCreate;
  }
});

test("API PATCH /documents/:id - returns 200 and updated document", async () => {
  const originalUpdate = documentService.updateDocument;
  documentService.updateDocument = async (id: string, payload: any) => ({
    ...mockDoc,
    ...payload,
    id
  });

  const payload = { title: "Novo Titulo" };

  try {
    const res = await fetch(`${baseUrl}/${mockDoc.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json() as Document;
    assert.strictEqual(body.id, mockDoc.id);
    assert.strictEqual(body.title, "Novo Titulo");
  } finally {
    documentService.updateDocument = originalUpdate;
  }
});

test("API DELETE /documents/:id - returns 200 on successful deletion", async () => {
  const originalDelete = documentService.deleteDocument;
  let deletedId = "";
  documentService.deleteDocument = async (id: string) => {
    deletedId = id;
  };

  try {
    const res = await fetch(`${baseUrl}/${mockDoc.id}`, {
      method: "DELETE"
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json() as any;
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.message.includes("excluído com sucesso"), true);
    assert.strictEqual(deletedId, mockDoc.id);
  } finally {
    documentService.deleteDocument = originalDelete;
  }
});
