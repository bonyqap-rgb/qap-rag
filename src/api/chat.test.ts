process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy_key";
process.env.GROQ_API_KEY = "dummy_key";
import { test, after } from "node:test";
import assert from "node:assert";
import express from "express";
import { Server } from "http";
import chatRouter from "./chat.js";
import { errorHandler } from "../middlewares/error.middleware.js";
import { ChatService } from "../services/chat.service.js";

// Initialize test app
const app = express();
app.set("trust proxy", 1);
app.use(express.json());
app.use("/chat", chatRouter);
app.use(errorHandler);

// Start server on random port
const server: Server = app.listen(0);
const address = server.address();
const port = typeof address === "string" ? 0 : address?.port;

const baseUrl = `http://localhost:${port}/chat`;

// Helper to close server
after(() => {
  server.close();
});

test("API POST /chat - success with 200 and structured response", async () => {
  const originalChat = ChatService.chat;
  ChatService.chat = async (question, options) => {
    assert.strictEqual(question, "qual o procedimento?");
    assert.strictEqual(options?.temperature, 0.5);
    return {
      answer: "Este é o procedimento padrão.",
      sources: [
        {
          documentId: "doc-123",
          filename: "manual.pdf",
          chunkIndex: 2,
          score: 0.95,
        },
      ],
      metadata: {
        searchTime: "12ms",
        generationTime: "300ms",
        totalTime: "312ms",
      },
    };
  };

  try {
    const res = await fetch(baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "qual o procedimento?", temperature: 0.5 }),
    });

    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as any;

    assert.strictEqual(body.answer, "Este é o procedimento padrão.");
    assert.ok(Array.isArray(body.sources));
    assert.strictEqual(body.sources.length, 1);
    assert.strictEqual(body.sources[0].filename, "manual.pdf");
    assert.strictEqual(body.sources[0].score, 0.95);
    assert.strictEqual(body.metadata.searchTime, "12ms");
  } finally {
    ChatService.chat = originalChat;
  }
});

test("API POST /chat - legacy support with 'question' field", async () => {
  const originalChat = ChatService.chat;
  ChatService.chat = async (question) => {
    assert.strictEqual(question, "procedimento?");
    return {
      answer: "Resposta",
      sources: [],
      metadata: { searchTime: "1ms", generationTime: "1ms", totalTime: "2ms" },
    };
  };

  try {
    const res = await fetch(baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "procedimento?" }),
    });

    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as any;
    assert.strictEqual(body.answer, "Resposta");
  } finally {
    ChatService.chat = originalChat;
  }
});

test("API POST /chat - returns 400 when message and question are empty", async () => {
  const res = await fetch(baseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "" }),
  });

  assert.strictEqual(res.status, 400);
  const body = (await res.json()) as any;
  assert.strictEqual(body.success, false);
  assert.ok(body.error.includes("O campo 'message' é obrigatório"));
});
