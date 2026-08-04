import test from "node:test";
import assert from "node:assert";
import { supabase } from "../config/supabase.js";
import { saveKnowledge } from "./saveKnowledge.js";

test("saveKnowledge - valid document", async () => {
  const originalFrom = supabase.from;
  let savedStatus = "";
  let insertedRows: any[] = [];

  supabase.from = function (table: string) {
    const builder = {
      insert: (payload: any) => {
        if (table === "knowledge_documents") {
          return {
            select: () => ({
              single: () => Promise.resolve({ data: { id: "mock-doc-id", file_name: "valid.pdf" }, error: null })
            })
          };
        }
        if (table === "knowledge_chunks") {
          insertedRows = payload;
          return Promise.resolve({ error: null });
        }
        return builder;
      },
      delete: () => {
        return builder;
      },
      eq: () => {
        return builder;
      },
      select: () => {
        return {
          eq: () => Promise.resolve({ data: null, count: 2, error: null }) // mock written count is 2 (matches rawChunks.length)
        };
      },
      update: (payload: any) => {
        if (table === "knowledge_documents" && payload.status) {
          savedStatus = payload.status;
        }
        return {
          eq: () => Promise.resolve({ error: null })
        };
      }
    };
    return builder as any;
  };

  try {
    const rawChunks = ["[PAGE:1] Primeiro chunk", "[PAGE:2] Segundo chunk"];
    const embeddings = [
      Array(1536).fill(0.1),
      Array(1536).fill(0.2)
    ];

    const docId = await saveKnowledge("valid.pdf", rawChunks, embeddings);

    assert.strictEqual(docId, "mock-doc-id");
    assert.strictEqual(savedStatus, "INDEXADO");
    assert.strictEqual(insertedRows.length, 2);
  } finally {
    supabase.from = originalFrom;
  }
});

test("saveKnowledge - document with no text (empty chunks)", async () => {
  const originalFrom = supabase.from;
  let savedStatus = "";

  supabase.from = function (table: string) {
    const builder = {
      insert: () => {
        if (table === "knowledge_documents") {
          return {
            select: () => ({
              single: () => Promise.resolve({ data: { id: "mock-doc-id", file_name: "empty.pdf" }, error: null })
            })
          };
        }
        return builder;
      },
      update: (payload: any) => {
        if (table === "knowledge_documents" && payload.status) {
          savedStatus = payload.status;
        }
        return {
          eq: () => Promise.resolve({ error: null })
        };
      }
    };
    return builder as any;
  };

  try {
    await assert.rejects(
      async () => {
        await saveKnowledge("empty.pdf", [], []);
      },
      (err: Error) => {
        assert.ok(err.message.includes("INDEXAÇÃO_INVÁLIDA"));
        assert.strictEqual(savedStatus, "INDEXAÇÃO_INVÁLIDA");
        return true;
      }
    );
  } finally {
    supabase.from = originalFrom;
  }
});

test("saveKnowledge - document with zero chunks", async () => {
  const originalFrom = supabase.from;
  let savedStatus = "";

  supabase.from = function (table: string) {
    const builder = {
      insert: () => {
        if (table === "knowledge_documents") {
          return {
            select: () => ({
              single: () => Promise.resolve({ data: { id: "mock-doc-id", file_name: "zero.pdf" }, error: null })
            })
          };
        }
        return builder;
      },
      update: (payload: any) => {
        if (table === "knowledge_documents" && payload.status) {
          savedStatus = payload.status;
        }
        return {
          eq: () => Promise.resolve({ error: null })
        };
      }
    };
    return builder as any;
  };

  try {
    await assert.rejects(
      async () => {
        await saveKnowledge("zero.pdf", [], []);
      },
      (err: Error) => {
        assert.ok(err.message.includes("INDEXAÇÃO_INVÁLIDA"));
        assert.strictEqual(savedStatus, "INDEXAÇÃO_INVÁLIDA");
        return true;
      }
    );
  } finally {
    supabase.from = originalFrom;
  }
});
