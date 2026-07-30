process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy_key";
process.env.GEMINI_API_KEY = "dummy_key";
import { test, after } from "node:test";
import assert from "node:assert";
import express from "express";
import { Server } from "http";
import searchRouter from "./search.js";
import { errorHandler } from "../middlewares/error.middleware.js";
import { SearchService } from "../services/search.service.js";

// Initialize test app
const app = express();
app.use(express.json());
app.use("/search", searchRouter);
app.use(errorHandler);

// Start server on random port
const server: Server = app.listen(0);
const address = server.address();
const port = typeof address === "string" ? 0 : address?.port;

const baseUrl = `http://localhost:${port}/search`;

// Helper to close server
after(() => {
  server.close();
});

test("API POST /search - returns 200 and search results with context on success", async () => {
  // Stub SearchService.search
  const originalSearch = SearchService.search;
  SearchService.search = async (queryText: string, topK?: number, scoreThreshold?: number, filters?: any) => {
    return [
      {
        documentId: "doc-123",
        chunkIndex: 2,
        score: 0.94,
        text: "Este é o trecho recuperado."
      }
    ];
  };

  try {
    const res = await fetch(baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "como funciona", topK: 3 })
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json() as any;

    assert.strictEqual(body.query, "como funciona");
    assert.ok(Array.isArray(body.results));
    assert.strictEqual(body.results.length, 1);
    assert.strictEqual(body.results[0].documentId, "doc-123");
    assert.strictEqual(body.results[0].score, 0.94);
    assert.strictEqual(body.results[0].text, "Este é o trecho recuperado.");
    assert.strictEqual(body.context, "Este é o trecho recuperado.");
  } finally {
    SearchService.search = originalSearch;
  }
});

test("API POST /search - returns 400 when query is missing", async () => {
  const res = await fetch(baseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topK: 5 })
  });

  assert.strictEqual(res.status, 400);
  const body = await res.json() as any;
  assert.strictEqual(body.success, false);
  assert.ok(body.error.includes("campo 'query' é obrigatório"));
});
