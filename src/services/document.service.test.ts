import { test } from "node:test";
import assert from "node:assert";
import fs from "fs";
import path from "path";
import { DocumentService, ValidationError, NotFoundError } from "./document.service.js";
import { DocumentRepository } from "../repositories/document.repository.js";
import { Document } from "../models/document.model.js";

// Dummy Document object
const sampleDocument: Document = {
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

// Mock DocumentRepository
class MockDocumentRepository extends DocumentRepository {
  public mockDocuments: Document[] = [];
  public shouldFind = true;
  public lastCreated: any = null;
  public lastUpdated: any = null;
  public lastDeletedId: string | null = null;

  constructor() {
    super({} as any); // pass empty SupabaseClient
  }

  override async list(): Promise<Document[]> {
    return this.mockDocuments;
  }

  override async getById(id: string): Promise<Document | null> {
    if (!this.shouldFind) return null;
    return { ...sampleDocument, id };
  }

  override async create(doc: any): Promise<Document> {
    this.lastCreated = doc;
    return {
      ...sampleDocument,
      ...doc,
      id: "new-uuid"
    };
  }

  override async update(id: string, doc: any): Promise<Document | null> {
    if (!this.shouldFind) return null;
    this.lastUpdated = doc;
    return {
      ...sampleDocument,
      ...doc,
      id
    };
  }

  override async delete(id: string): Promise<boolean> {
    if (!this.shouldFind) return false;
    this.lastDeletedId = id;
    return true;
  }
}

test("DocumentService - listDocuments() returns documents", async () => {
  const repo = new MockDocumentRepository();
  repo.mockDocuments = [sampleDocument];
  const service = new DocumentService(repo);

  const result = await service.listDocuments();
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].id, sampleDocument.id);
});

test("DocumentService - getDocumentById() returns document when found", async () => {
  const repo = new MockDocumentRepository();
  const service = new DocumentService(repo);

  const result = await service.getDocumentById("some-id");
  assert.strictEqual(result.id, "some-id");
});

test("DocumentService - getDocumentById() throws NotFoundError when not found", async () => {
  const repo = new MockDocumentRepository();
  repo.shouldFind = false;
  const service = new DocumentService(repo);

  await assert.rejects(
    async () => {
      await service.getDocumentById("some-id");
    },
    (err: Error) => {
      assert.ok(err instanceof NotFoundError);
      assert.strictEqual(err.message.includes("não encontrado"), true);
      return true;
    }
  );
});

test("DocumentService - processDocument() handles non-existent document ID", async () => {
  const repo = new MockDocumentRepository();
  repo.shouldFind = false;
  const service = new DocumentService(repo);

  await assert.rejects(
    async () => {
      await service.processDocument("non-existent-id");
    },
    (err: Error) => {
      assert.ok(err instanceof NotFoundError);
      return true;
    }
  );
});

test("DocumentService - processDocument() throws on non-pending document", async () => {
  const repo = new MockDocumentRepository();
  const service = new DocumentService(repo);

  // Set sample document to already completed
  repo.getById = async (id: string) => ({
    ...sampleDocument,
    id,
    processingStatus: "completed"
  });

  await assert.rejects(
    async () => {
      await service.processDocument("completed-doc-id");
    },
    (err: Error) => {
      assert.ok(err instanceof ValidationError);
      assert.strictEqual(err.message.includes("já foi processado"), true);
      return true;
    }
  );
});

test("DocumentService - processDocument() handles missing physical PDF file error", async () => {
  const repo = new MockDocumentRepository();
  const service = new DocumentService(repo);

  // Set non-existent physical file name
  repo.getById = async (id: string) => ({
    ...sampleDocument,
    id,
    filename: "missing_file_xyz.pdf",
    processingStatus: "pending"
  });

  let statusHistory: string[] = [];
  repo.update = async (id: string, payload: any) => {
    if (payload.processingStatus) {
      statusHistory.push(payload.processingStatus);
    }
    return { ...sampleDocument, ...payload, id };
  };

  await assert.rejects(
    async () => {
      await service.processDocument("some-id");
    },
    (err: Error) => {
      assert.ok(err instanceof ValidationError);
      assert.strictEqual(err.message.includes("Falha no processamento"), true);
      return true;
    }
  );

  // Status transitions check: should have entered "processing" and then finished as "failed"
  assert.strictEqual(statusHistory[0], "processing");
  assert.strictEqual(statusHistory[1], "failed");
});

test("DocumentService - processDocument() successfully parses valid PDF and updates metadata", async () => {
  const repo = new MockDocumentRepository();
  const service = new DocumentService(repo);

  const filename = "test_processing.pdf";
  const testDocPath = path.join("storage", "documents", filename);

  // Write a valid tiny 1-page PDF
  fs.mkdirSync(path.dirname(testDocPath), { recursive: true });
  fs.writeFileSync(testDocPath, "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << >> /Contents 4 0 R >>\nendobj\n4 0 obj\n<< >>\nstream\nBT /F1 12 Tf 100 700 Td (Hello World) Tj ET\nendstream\nendobj\nxref\n0 5\n0000000000 65535 f \n0000000009 00000 n \n0000000056 00000 n \n0000000111 00000 n \n0000000193 00000 n \ntrailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n240\n%%EOF");

  repo.getById = async (id: string) => ({
    ...sampleDocument,
    id,
    filename,
    processingStatus: "pending"
  });

  let lastPayload: any = null;
  repo.update = async (id: string, payload: any) => {
    lastPayload = payload;
    return { ...sampleDocument, ...payload, id };
  };

  try {
    const result = await service.processDocument("some-id");
    assert.strictEqual(result.processingStatus, "completed");
    assert.strictEqual(result.totalPages, 1);
    assert.strictEqual(result.extractedText?.includes("Hello World"), true);

    // Verify last payload matched DB commit
    assert.strictEqual(lastPayload.processingStatus, "completed");
    assert.strictEqual(lastPayload.totalPages, 1);
    assert.strictEqual(lastPayload.extractedText?.includes("Hello World"), true);
  } finally {
    // Cleanup
    if (fs.existsSync(testDocPath)) {
      fs.unlinkSync(testDocPath);
    }
  }
});

test("DocumentService - createDocument() validates required fields", async () => {
  const repo = new MockDocumentRepository();
  const service = new DocumentService(repo);

  // Missing title
  const invalidPayload: any = {
    category: "Segurança",
    version: "1.0.0",
    source: "Manual",
    language: "pt-BR",
    filename: "test.pdf",
    fileSize: 100,
    mimeType: "application/pdf",
    totalPages: 5
  };

  await assert.rejects(
    async () => {
      await service.createDocument(invalidPayload);
    },
    (err: Error) => {
      assert.ok(err instanceof ValidationError);
      assert.strictEqual(err.message.includes("title' é obrigatório"), true);
      return true;
    }
  );
});

test("DocumentService - createDocument() validates title length", async () => {
  const repo = new MockDocumentRepository();
  const service = new DocumentService(repo);

  const invalidPayload = {
    title: "a".repeat(256), // Exceeds 255
    category: "Segurança",
    version: "1.0.0",
    source: "Manual",
    language: "pt-BR",
    filename: "test.pdf",
    fileSize: 100,
    mimeType: "application/pdf",
    totalPages: 5
  };

  await assert.rejects(
    async () => {
      await service.createDocument(invalidPayload);
    },
    (err: Error) => {
      assert.ok(err instanceof ValidationError);
      assert.strictEqual(err.message.includes("não pode exceder 255 caracteres"), true);
      return true;
    }
  );
});

test("DocumentService - createDocument() validates version format", async () => {
  const repo = new MockDocumentRepository();
  const service = new DocumentService(repo);

  const invalidPayload = {
    title: "Documento Válido",
    category: "Segurança",
    version: "v1.0", // Invalid, has 'v' prefix
    source: "Manual",
    language: "pt-BR",
    filename: "test.pdf",
    fileSize: 100,
    mimeType: "application/pdf",
    totalPages: 5
  };

  await assert.rejects(
    async () => {
      await service.createDocument(invalidPayload);
    },
    (err: Error) => {
      assert.ok(err instanceof ValidationError);
      assert.strictEqual(err.message.includes("formato do campo 'version' é inválido"), true);
      return true;
    }
  );
});

test("DocumentService - createDocument() succeeds with valid inputs", async () => {
  const repo = new MockDocumentRepository();
  const service = new DocumentService(repo);

  const validPayload = {
    title: "Documento Válido",
    category: "Segurança",
    version: "1.0",
    source: "Manual",
    language: "pt-BR",
    filename: "test.pdf",
    fileSize: 100,
    mimeType: "application/pdf",
    totalPages: 5
  };

  const result = await service.createDocument(validPayload);
  assert.strictEqual(result.id, "new-uuid");
  assert.strictEqual(result.title, validPayload.title);
  assert.strictEqual(result.processingStatus, "pending");
});

test("DocumentService - updateDocument() validates partial properties", async () => {
  const repo = new MockDocumentRepository();
  const service = new DocumentService(repo);

  await assert.rejects(
    async () => {
      await service.updateDocument("some-id", { title: "a".repeat(256) });
    },
    (err: Error) => {
      assert.ok(err instanceof ValidationError);
      assert.strictEqual(err.message.includes("não pode exceder 255 caracteres"), true);
      return true;
    }
  );

  await assert.rejects(
    async () => {
      await service.updateDocument("some-id", { version: "invalid_format" });
    },
    (err: Error) => {
      assert.ok(err instanceof ValidationError);
      assert.strictEqual(err.message.includes("formato do campo 'version' é inválido"), true);
      return true;
    }
  );
});

test("DocumentService - updateDocument() throws NotFoundError if not found", async () => {
  const repo = new MockDocumentRepository();
  repo.shouldFind = false;
  const service = new DocumentService(repo);

  await assert.rejects(
    async () => {
      await service.updateDocument("non-existent", { title: "Novo Titulo" });
    },
    (err: Error) => {
      assert.ok(err instanceof NotFoundError);
      return true;
    }
  );
});

test("DocumentService - deleteDocument() successfully calls repository", async () => {
  const repo = new MockDocumentRepository();
  const service = new DocumentService(repo);

  await service.deleteDocument("some-id");
  assert.strictEqual(repo.lastDeletedId, "some-id");
});

test("DocumentService - deleteDocument() throws NotFoundError if not found", async () => {
  const repo = new MockDocumentRepository();
  repo.shouldFind = false;
  const service = new DocumentService(repo);

  await assert.rejects(
    async () => {
      await service.deleteDocument("non-existent");
    },
    (err: Error) => {
      assert.ok(err instanceof NotFoundError);
      return true;
    }
  );
});
