process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy_key";
process.env.GROQ_API_KEY = "dummy_key";

import { test, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import express from "express";
import { Server } from "http";
import uploadRouter from "./upload.js";
import { errorHandler } from "../middlewares/error.middleware.js";
import { supabase } from "../config/supabase.js";
import { setReadPdfImplementation, resetReadPdfImplementation } from "../pdf/readPdf.js";
import { setEmbeddingImplementation, resetEmbeddingImplementation } from "../groq/embed.js";

// Initialize express app for testing upload
const app = express();
app.set("trust proxy", 1);
app.use(express.json());
app.use("/upload", uploadRouter);
app.use(errorHandler);

const server: Server = app.listen(0);
const address = server.address();
const port = typeof address === "string" ? 0 : address?.port;
const baseUrl = `http://localhost:${port}/upload`;

// Tracking variables for assertions
let storageUploadCalled = false;
let dbInsertedDoc: any = null;
let dbUpdatedDocs: any[] = [];
let storageUploadFailMode = false;
let insertedChunksCount = 0;

// Save original methods
const originalFrom = supabase.from;
const originalStorage = supabase.storage;

beforeEach(() => {
  storageUploadCalled = false;
  dbInsertedDoc = null;
  dbUpdatedDocs = [];
  storageUploadFailMode = false;
  insertedChunksCount = 0;

  // Mock Supabase Storage
  supabase.storage = {
    from: (bucket: string) => {
      assert.strictEqual(bucket, "documents");
      return {
        upload: async (path: string, buffer: Buffer, options: any) => {
          storageUploadCalled = true;
          if (storageUploadFailMode) {
            return { data: null, error: new Error("Mock Storage Upload Error") };
          }
          return { data: { path }, error: null };
        }
      } as any;
    }
  } as any;

  // Mock Supabase Database
  supabase.from = function (table: string): any {
    const builder: any = {
      select: (selectField: any, selectOpts: any) => {
        if (selectOpts && selectOpts.count === "exact") {
          return {
            eq: () => Promise.resolve({ count: insertedChunksCount, error: null })
          };
        }
        return {
          eq: (field: string, val: any) => {
            return {
              maybeSingle: () => {
                if (field === "id") {
                  return Promise.resolve({ data: { id: val, status: "PROCESSANDO" }, error: null });
                }
                if (field === "file_name" && dbInsertedDoc) {
                  return Promise.resolve({ data: { id: "mock-doc-uuid-123", status: "PROCESSANDO" }, error: null });
                }
                return Promise.resolve({ data: null, error: null });
              }
            };
          }
        };
      },
      insert: (payload: any) => {
        if (table === "knowledge_documents") {
          dbInsertedDoc = payload;
          return {
            select: () => ({
              single: () => Promise.resolve({
                data: {
                  id: "mock-doc-uuid-123",
                  file_name: payload.file_name,
                  storage_path: payload.storage_path,
                  status: payload.status
                },
                error: null
              })
            })
          };
        }
        if (table === "knowledge_chunks") {
          const arr = Array.isArray(payload) ? payload : [payload];
          insertedChunksCount += arr.length;
          return Promise.resolve({ error: null });
        }
        return Promise.resolve({ error: null });
      },
      update: (payload: any) => {
        dbUpdatedDocs.push(payload);
        return {
          eq: (field: string, val: any) => {
            const res = {
              select: () => ({
                single: () => Promise.resolve({
                  data: {
                    id: "mock-doc-uuid-123",
                    file_name: "test.pdf",
                    storage_path: payload.storage_path,
                    status: payload.status
                  },
                  error: null
                })
              }),
              then: (cb: any) => Promise.resolve({ error: null }).then(cb)
            };
            return res as any;
          }
        };
      },
      delete: () => {
        return {
          eq: () => Promise.resolve({ error: null })
        };
      },
      eq: () => {
        return builder;
      }
    };
    return builder;
  };

  // Mock PDF Reader and Embeddings
  setReadPdfImplementation(async (buf) => {
    return "[PAGE_MARKER:1]\nPrimeiro chunk do PDF de teste";
  });

  setEmbeddingImplementation(async (text) => {
    return Array(1536).fill(0.123);
  });
});

afterEach(() => {
  resetReadPdfImplementation();
  resetEmbeddingImplementation();
  supabase.from = originalFrom;
  supabase.storage = originalStorage;
});

after(() => {
  server.close();
});

test("POST /upload - Successful end-to-end PDF upload and indexation", async () => {
  // Construct a multipart body for multer
  const boundary = "----TestBoundary" + Math.random().toString(36).substring(2);
  const bodyParts = [
    `--${boundary}\r\n`,
    `Content-Disposition: form-data; name="file"; filename="test.pdf"\r\n`,
    `Content-Type: application/pdf\r\n\r\n`,
    `%PDF-1.4 dummy pdf content`,
    `\r\n--${boundary}--\r\n`
  ];
  const payloadBuffer = Buffer.concat(bodyParts.map(p => Buffer.from(p)));

  const res = await fetch(baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`
    },
    body: payloadBuffer
  });

  assert.strictEqual(res.status, 200);
  const data = await res.json() as any;
  assert.strictEqual(data.success, true);
  assert.strictEqual(data.documentId, "mock-doc-uuid-123");
  assert.strictEqual(data.fileName, "test.pdf");

  // Validate Storage was called
  assert.strictEqual(storageUploadCalled, true);

  // Validate knowledge_documents was inserted with storage_path and PROCESSANDO status
  assert.ok(dbInsertedDoc);
  assert.strictEqual(dbInsertedDoc.file_name, "test.pdf");
  assert.strictEqual(dbInsertedDoc.storage_path, "documents/test.pdf");
  assert.strictEqual(dbInsertedDoc.status, "PROCESSANDO");

  // Validate final status updated to INDEXADO
  const finalUpdate = dbUpdatedDocs.find(d => d.status === "INDEXADO");
  assert.ok(finalUpdate);
  assert.strictEqual(finalUpdate.total_chunks, 1);
  assert.strictEqual(finalUpdate.total_embeddings, 1);
});

test("POST /upload - Storage failure transitions status to INDEXAÇÃO_INVÁLIDA", async () => {
  storageUploadFailMode = true;

  const boundary = "----TestBoundary" + Math.random().toString(36).substring(2);
  const bodyParts = [
    `--${boundary}\r\n`,
    `Content-Disposition: form-data; name="file"; filename="fail-test.pdf"\r\n`,
    `Content-Type: application/pdf\r\n\r\n`,
    `%PDF-1.4 dummy pdf content`,
    `\r\n--${boundary}--\r\n`
  ];
  const payloadBuffer = Buffer.concat(bodyParts.map(p => Buffer.from(p)));

  const res = await fetch(baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`
    },
    body: payloadBuffer
  });

  // Verify failure status is returned
  assert.strictEqual(res.status, 500);

  // Verify that an INDEXAÇÃO_INVÁLIDA document record was created
  assert.ok(dbInsertedDoc);
  assert.strictEqual(dbInsertedDoc.file_name, "fail-test.pdf");
  assert.strictEqual(dbInsertedDoc.status, "INDEXAÇÃO_INVÁLIDA");
});
