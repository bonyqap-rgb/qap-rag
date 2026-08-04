import test from "node:test";
import assert from "node:assert";
import { supabase } from "../config/supabase.js";
import { saveKnowledge } from "./saveKnowledge.js";

// Helper helper function to create a mock supabase.from implementation
function createMockSupabase(options: {
  existingDoc?: any;
  insertedDoc?: any;
  updatedDoc?: any;
  insertedChunks?: any[];
  countChunksResult?: number;
} = {}) {
  return function (table: string): any {
    const builder: any = {
      select: (selectField: any, selectOpts: any) => {
        if (selectOpts && selectOpts.count === "exact") {
          return {
            eq: () => Promise.resolve({ count: options.countChunksResult ?? 2, error: null })
          };
        }
        return {
          eq: (field: string, val: any) => {
            return {
              maybeSingle: () => Promise.resolve({ data: options.existingDoc ?? null, error: null })
            };
          },
          maybeSingle: () => Promise.resolve({ data: options.existingDoc ?? null, error: null })
        };
      },
      insert: (payload: any) => {
        if (table === "knowledge_chunks") {
          if (options.insertedChunks) {
            options.insertedChunks.push(...(Array.isArray(payload) ? payload : [payload]));
          }
          return Promise.resolve({ error: null });
        }
        return {
          select: () => ({
            single: () => Promise.resolve({ data: options.insertedDoc ?? { id: "mock-doc-id", file_name: "valid.pdf" }, error: null })
          })
        };
      },
      update: (payload: any) => {
        if (options.updatedDoc) {
          options.updatedDoc.payload = payload;
        }
        return {
          eq: () => {
            const res = {
              select: () => ({
                single: () => Promise.resolve({ data: options.insertedDoc ?? { id: "mock-doc-id", file_name: "valid.pdf" }, error: null })
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
}

test("saveKnowledge - valid document", async () => {
  const originalFrom = supabase.from;
  const updatedDoc = { payload: null as any };
  const insertedChunks: any[] = [];

  supabase.from = createMockSupabase({
    insertedDoc: { id: "mock-doc-id", file_name: "valid.pdf" },
    updatedDoc,
    insertedChunks,
    countChunksResult: 2
  });

  try {
    const rawChunks = ["[PAGE:1] Primeiro chunk", "[PAGE:2] Segundo chunk"];
    const embeddings = [
      Array(1536).fill(0.1),
      Array(1536).fill(0.2)
    ];

    const docId = await saveKnowledge("valid.pdf", rawChunks, embeddings);

    assert.strictEqual(docId, "mock-doc-id");
    assert.strictEqual(updatedDoc.payload?.status, "INDEXADO");
    assert.strictEqual(insertedChunks.length, 2);
  } finally {
    supabase.from = originalFrom;
  }
});

test("saveKnowledge - document with no text (empty chunks)", async () => {
  const originalFrom = supabase.from;
  const updatedDoc = { payload: null as any };

  supabase.from = createMockSupabase({
    insertedDoc: { id: "mock-doc-id", file_name: "empty.pdf" },
    updatedDoc,
    countChunksResult: 0
  });

  try {
    await assert.rejects(
      async () => {
        await saveKnowledge("empty.pdf", [], []);
      },
      (err: Error) => {
        assert.ok(err.message.includes("INDEXAÇÃO_INVÁLIDA"));
        assert.strictEqual(updatedDoc.payload?.status, "INDEXAÇÃO_INVÁLIDA");
        return true;
      }
    );
  } finally {
    supabase.from = originalFrom;
  }
});

test("saveKnowledge - document with zero chunks", async () => {
  const originalFrom = supabase.from;
  const updatedDoc = { payload: null as any };

  supabase.from = createMockSupabase({
    insertedDoc: { id: "mock-doc-id", file_name: "zero.pdf" },
    updatedDoc,
    countChunksResult: 0
  });

  try {
    await assert.rejects(
      async () => {
        await saveKnowledge("zero.pdf", [], []);
      },
      (err: Error) => {
        assert.ok(err.message.includes("INDEXAÇÃO_INVÁLIDA"));
        assert.strictEqual(updatedDoc.payload?.status, "INDEXAÇÃO_INVÁLIDA");
        return true;
      }
    );
  } finally {
    supabase.from = originalFrom;
  }
});

test("saveKnowledge - safe reindexing on existing INDEXAÇÃO_INVÁLIDA document", async () => {
  const originalFrom = supabase.from;
  const updatedDoc = { payload: null as any };
  const insertedChunks: any[] = [];

  // Mocking that an existing doc was found with status INDEXAÇÃO_INVÁLIDA
  supabase.from = createMockSupabase({
    existingDoc: { id: "existing-uuid-123", status: "INDEXAÇÃO_INVÁLIDA" },
    insertedDoc: { id: "existing-uuid-123", file_name: "invalid_to_valid.pdf" },
    updatedDoc,
    insertedChunks,
    countChunksResult: 2
  });

  try {
    const rawChunks = ["[PAGE:1] Primeiro chunk do PDF", "[PAGE:2] Segundo chunk do PDF"];
    const embeddings = [
      Array(1536).fill(0.3),
      Array(1536).fill(0.4)
    ];

    const docId = await saveKnowledge("invalid_to_valid.pdf", rawChunks, embeddings);

    assert.strictEqual(docId, "existing-uuid-123");
    // Verify that the status updated to INDEXADO after safe reindexing
    assert.strictEqual(updatedDoc.payload?.status, "INDEXADO");
    assert.strictEqual(insertedChunks.length, 2);
  } finally {
    supabase.from = originalFrom;
  }
});
