import { test } from "node:test";
import assert from "node:assert";
import { env } from "../config/env.js";
import { DocumentService } from "../services/document.service.js";
import { runMigration } from "./migrate-vectors.js";

test("migrate-vectors script - throws if VOYAGE_API_KEY is missing", async () => {
  const originalVoyageKey = env.VOYAGE_API_KEY;
  env.VOYAGE_API_KEY = undefined;

  try {
    await assert.rejects(
      () => runMigration(),
      /A variável de ambiente VOYAGE_API_KEY não está configurada/
    );
  } finally {
    env.VOYAGE_API_KEY = originalVoyageKey;
  }
});

test("migrate-vectors script - successfully processes only completed documents", async () => {
  const originalVoyageKey = env.VOYAGE_API_KEY;
  env.VOYAGE_API_KEY = "mock-voyage-key";

  const originalList = DocumentService.prototype.listDocuments;
  const originalReindex = DocumentService.prototype.reindexDocument;

  const mockDocs = [
    {
      id: "doc-1",
      title: "Documento Completo 1",
      filename: "doc1.pdf",
      processingStatus: "completed" as const,
      category: "Geral",
      version: "1.0.0",
      source: "Manual",
      language: "pt-BR",
      fileSize: 100,
      mimeType: "application/pdf",
      totalPages: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: "doc-2",
      title: "Documento Pendente",
      filename: "doc2.pdf",
      processingStatus: "pending" as const,
      category: "Geral",
      version: "1.0.0",
      source: "Manual",
      language: "pt-BR",
      fileSize: 100,
      mimeType: "application/pdf",
      totalPages: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    {
      id: "doc-3",
      title: "Documento Completo 2",
      filename: "doc3.pdf",
      processingStatus: "completed" as const,
      category: "Geral",
      version: "1.0.0",
      source: "Manual",
      language: "pt-BR",
      fileSize: 100,
      mimeType: "application/pdf",
      totalPages: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ];

  const reindexedIds: string[] = [];

  DocumentService.prototype.listDocuments = async () => mockDocs;
  DocumentService.prototype.reindexDocument = async (id: string) => {
    reindexedIds.push(id);
    return {
      success: true,
      message: "Sucesso",
      chunksCount: 5,
      durationMs: 120
    };
  };

  try {
    const result = await runMigration();
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.migratedCount, 2);
    assert.deepStrictEqual(reindexedIds, ["doc-1", "doc-3"]);
  } finally {
    env.VOYAGE_API_KEY = originalVoyageKey;
    DocumentService.prototype.listDocuments = originalList;
    DocumentService.prototype.reindexDocument = originalReindex;
  }
});
