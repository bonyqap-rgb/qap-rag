process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy_key";
process.env.GROQ_API_KEY = "dummy_key";
import { test, after } from "node:test";
import assert from "node:assert";
import express from "express";
import { Server } from "http";
import chatRouter from "../api/chat.js";
import { chatRateLimiter, createRateLimitHandler } from "./rate-limit.middleware.js";
import { errorHandler } from "./error.middleware.js";
import { ChatService } from "../services/chat.service.js";

// Initialize express app with low rate limit of 2 requests for testing
const app = express();
app.use(express.json());

app.use("/chat", chatRateLimiter, chatRouter);
app.use(errorHandler);

const server: Server = app.listen(0);
const address = server.address();
const port = typeof address === "string" ? 0 : address?.port;
const baseUrl = `http://localhost:${port}/chat`;

after(() => {
  server.close();
});

test("Rate Limit Handler - formats 429 error correctly", () => {
  const handler = createRateLimitHandler("Teste de limite");

  const dummyReq = {
    originalUrl: "/chat",
    headers: {
      "x-request-id": "test-req-id",
    },
  } as any;

  let responseStatus = 0;
  let responseBody: any = null;

  const dummyRes = {
    status(code: number) {
      responseStatus = code;
      return this;
    },
    json(body: any) {
      responseBody = body;
      return this;
    },
  } as any;

  handler(dummyReq, dummyRes);

  assert.strictEqual(responseStatus, 429);
  assert.strictEqual(responseBody.error, "TOO_MANY_REQUESTS");
  assert.strictEqual(responseBody.message, "Teste de limite");
  assert.strictEqual(responseBody.route, "/chat");
  assert.strictEqual(responseBody.requestId, "test-req-id");
});

test("Express trust proxy configuration - validates proxy header handling", async () => {
  // Setup a test Express app mimicking index.ts trust proxy config
  const testApp = express();
  testApp.set("trust proxy", 1);
  testApp.use(express.json());

  testApp.get("/test-proxy", chatRateLimiter, (req, res) => {
    res.json({
      ip: req.ip,
      ips: req.ips,
      header: req.headers["x-forwarded-for"],
    });
  });

  const testServer = testApp.listen(0);
  const testAddress = testServer.address();
  const testPort = typeof testAddress === "string" ? 0 : testAddress?.port;

  try {
    const response = await fetch(`http://localhost:${testPort}/test-proxy`, {
      headers: {
        "X-Forwarded-For": "203.0.113.195",
      },
    });

    assert.strictEqual(response.status, 200);
    const data: any = await response.json();

    // With trust proxy set to 1, the leftmost IP in X-Forwarded-For (or the client IP from the first proxy hop)
    // should be correctly trusted and returned as req.ip.
    assert.strictEqual(data.ip, "203.0.113.195");
  } finally {
    testServer.close();
  }
});
