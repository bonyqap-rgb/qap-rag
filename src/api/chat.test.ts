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

test("API POST /chat/diagnose - success in development with RAG diagnostic JSON", async () => {
  const originalDiagnose = ChatService.diagnose;
  const originalNodeEnv = process.env.NODE_ENV;
  // Ensure we are treated as dev/test environment
  process.env.NODE_ENV = "development";

  ChatService.diagnose = async (question, options) => {
    assert.strictEqual(question, "Como auditar o RAG?");
    return {
      pergunta: question,
      embedding_gerado: [0.1, 0.2, 0.3],
      chunks_encontrados: [
        {
          id: "chunk-1",
          documentId: "doc-1",
          filename: "manual.pdf",
          chunkIndex: 0,
          score: 0.9,
          page: 1,
          text: "Trecho de auditoria",
          usedInContext: true,
        }
      ],
      score: {
        total_encontrados: 1,
        max_score: 0.9,
        avg_score: 0.9,
        threshold_utilizado: 0.3,
      },
      documentos: ["manual.pdf"],
      paginas: [1],
      "páginas": [1],
      contexto_final: "Trecho de auditoria",
      prompt_enviado: {
        systemPrompt: "Instruções do Sistema",
        userPrompt: "Prompt do Usuário",
        completo: "Prompt Completo",
      },
      resposta_do_modelo: "Resposta auditada",
      metadata: { model: "llama3", duration_ms: 120 },
    };
  };

  try {
    const res = await fetch(`${baseUrl}/diagnose`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Como auditar o RAG?" }),
    });

    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as any;

    assert.strictEqual(body.pergunta, "Como auditar o RAG?");
    assert.deepStrictEqual(body.embedding_gerado, [0.1, 0.2, 0.3]);
    assert.strictEqual(body.chunks_encontrados[0].id, "chunk-1");
    assert.strictEqual(body.score.max_score, 0.9);
    assert.strictEqual(body.resposta_do_modelo, "Resposta auditada");
  } finally {
    ChatService.diagnose = originalDiagnose;
    process.env.NODE_ENV = originalNodeEnv;
  }
});

test("API POST /chat/diagnose - returns 403 when in production environment", async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  // Simulate production environment
  process.env.NODE_ENV = "production";

  try {
    const res = await fetch(`${baseUrl}/diagnose`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Como auditar o RAG?" }),
    });

    assert.strictEqual(res.status, 403);
    const body = (await res.json()) as any;
    assert.strictEqual(body.success, false);
    assert.ok(body.error.includes("disponível apenas no ambiente de desenvolvimento"));
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
  }
});
