process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy_key";
process.env.GOOGLE_API_KEY = "dummy_key";
process.env.OPENROUTER_API_KEY = "dummy_key";

import { test, after } from "node:test";
import assert from "node:assert";
import express from "express";
import { Server } from "http";
import healthRouter from "./health.js";
import { supabase } from "../config/supabase.js";

const app = express();
app.use("/", healthRouter);

const server: Server = app.listen(0);
const address = server.address();
const port = typeof address === "string" ? 0 : address?.port;
const baseUrl = `http://localhost:${port}`;

after(() => {
  server.close();
});

test("GET /health - returns basic status successfully", async () => {
  const res = await fetch(`${baseUrl}/health`);
  assert.strictEqual(res.status, 200);

  const data = (await res.json()) as any;
  assert.strictEqual(data.status, "ok");
  assert.ok(data.uptime > 0);
  assert.ok(typeof data.timestamp === "string");
});

test("GET /ready - returns deep readiness status details", async () => {
  // Stub Supabase Select
  const originalFrom = supabase.from;
  const originalRpc = supabase.rpc;

  supabase.from = (table: string) => {
    assert.strictEqual(table, "knowledge_documents");
    return {
      select: () => ({
        limit: () => Promise.resolve({ data: [{ id: "test-id" }], error: null }),
      }),
    } as any;
  };

  supabase.rpc = (fn: string) => {
    assert.strictEqual(fn, "match_documents");
    return Promise.resolve({ data: [], error: null }) as any;
  };

  try {
    const res = await fetch(`${baseUrl}/ready`);
    assert.strictEqual(res.status, 200);

    const data = (await res.json()) as any;
    assert.strictEqual(data.status, "ok");
    assert.strictEqual(data.database.status, "ok");
    assert.strictEqual(data.pgvector.status, "ok");
    assert.strictEqual(data.config.status, "ok");
  } finally {
    supabase.from = originalFrom;
    supabase.rpc = originalRpc;
  }
});
