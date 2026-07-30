process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy_key";
process.env.GROQ_API_KEY = "dummy_key";
import { test } from "node:test";
import assert from "node:assert";
import { DocumentRepository } from "./document.repository.js";
import { DbDocument } from "../models/document.model.js";
import { SupabaseClient } from "@supabase/supabase-js";

// Helper helper to create mock Supabase client
function createMockSupabase(mockData: any, mockError: any = null): SupabaseClient {
  const queryBuilder = {
    select: () => queryBuilder,
    order: () => queryBuilder,
    insert: () => queryBuilder,
    update: () => queryBuilder,
    delete: () => queryBuilder,
    eq: () => queryBuilder,
    single: () => Promise.resolve({ data: mockData, error: mockError }),
    maybeSingle: () => Promise.resolve({ data: mockData, error: mockError }),
    then: (resolve: any) => resolve({ data: mockData, error: mockError })
  };

  return {
    from: () => queryBuilder
  } as unknown as SupabaseClient;
}

const mockDbDocument: DbDocument = {
  id: "8c77be02-4ee3-455b-80df-67993a4bc4d4",
  title: "Documento de Teste",
  category: "Segurança",
  version: "1.0.0",
  source: "Manual PM",
  language: "pt-BR",
  filename: "manual_pm.pdf",
  file_size: 102400,
  mime_type: "application/pdf",
  total_pages: 15,
  processing_status: "pending",
  created_at: "2023-10-10T12:00:00Z",
  updated_at: "2023-10-10T12:00:00Z"
};

test("DocumentRepository - list() returns mapped documents", async () => {
  const mockSupabase = createMockSupabase([mockDbDocument]);
  const repository = new DocumentRepository(mockSupabase);

  const result = await repository.list();
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].id, mockDbDocument.id);
  assert.strictEqual(result[0].title, mockDbDocument.title);
  assert.strictEqual(result[0].fileSize, mockDbDocument.file_size);
  assert.strictEqual(result[0].processingStatus, "pending");
});

test("DocumentRepository - getById() returns mapped document when found", async () => {
  const mockSupabase = createMockSupabase(mockDbDocument);
  const repository = new DocumentRepository(mockSupabase);

  const result = await repository.getById(mockDbDocument.id);
  assert.notStrictEqual(result, null);
  assert.strictEqual(result!.id, mockDbDocument.id);
  assert.strictEqual(result!.title, mockDbDocument.title);
});

test("DocumentRepository - getById() returns null when not found", async () => {
  const mockSupabase = createMockSupabase(null);
  const repository = new DocumentRepository(mockSupabase);

  const result = await repository.getById("non-existent");
  assert.strictEqual(result, null);
});

test("DocumentRepository - create() inserts and returns mapped document", async () => {
  const mockSupabase = createMockSupabase(mockDbDocument);
  const repository = new DocumentRepository(mockSupabase);

  const input = {
    title: "Documento de Teste",
    category: "Segurança",
    version: "1.0.0",
    source: "Manual PM",
    language: "pt-BR",
    filename: "manual_pm.pdf",
    fileSize: 102400,
    mimeType: "application/pdf",
    totalPages: 15,
    processingStatus: "pending" as const
  };

  const result = await repository.create(input);
  assert.strictEqual(result.id, mockDbDocument.id);
  assert.strictEqual(result.title, input.title);
  assert.strictEqual(result.fileSize, input.fileSize);
});

test("DocumentRepository - update() modifies and returns mapped document", async () => {
  const updatedDbDoc = { ...mockDbDocument, title: "Novo Titulo" };
  const mockSupabase = createMockSupabase(updatedDbDoc);
  const repository = new DocumentRepository(mockSupabase);

  const result = await repository.update(mockDbDocument.id, { title: "Novo Titulo" });
  assert.notStrictEqual(result, null);
  assert.strictEqual(result!.id, mockDbDocument.id);
  assert.strictEqual(result!.title, "Novo Titulo");
});

test("DocumentRepository - delete() returns true on success", async () => {
  const mockSupabase = createMockSupabase([mockDbDocument]);
  const repository = new DocumentRepository(mockSupabase);

  const result = await repository.delete(mockDbDocument.id);
  assert.strictEqual(result, true);
});

test("DocumentRepository - delete() returns false if not found", async () => {
  const mockSupabase = createMockSupabase([]);
  const repository = new DocumentRepository(mockSupabase);

  const result = await repository.delete("non-existent");
  assert.strictEqual(result, false);
});
