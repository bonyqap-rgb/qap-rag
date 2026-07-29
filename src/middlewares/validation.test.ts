import { test } from "node:test";
import assert from "node:assert";
import { sanitizeInput, validatePayload } from "./validation.middleware.js";

test("sanitizeInput - escapes dangerous HTML and script injection characters", () => {
  const dangerous = "<script>alert('xss');</script> & other \"quotes\"";
  const safe = sanitizeInput(dangerous);

  assert.strictEqual(
    safe,
    "&lt;script&gt;alert(&#x27;xss&#x27;);&lt;&#x2F;script&gt; &amp; other &quot;quotes&quot;"
  );
});

test("validatePayload - rejects incorrect types and sanitises strings", () => {
  const middleware = validatePayload({
    username: "string",
    age: "number",
    active: "boolean",
  });

  const timestamp = new Date().toISOString();

  // Test Case 1: Incorrect types (should return 400 and stop)
  const req1 = {
    body: {
      username: "john_doe",
      age: "thirty", // Invalid type (should be number)
    },
    originalUrl: "/test-route",
    headers: {
      "x-request-id": "req-123",
    },
  } as any;

  let responseStatus = 0;
  let responseBody: any = null;

  const res1 = {
    status(code: number) {
      responseStatus = code;
      return this;
    },
    json(body: any) {
      responseBody = body;
      return this;
    },
  } as any;

  let nextCalled = false;
  const next1 = () => {
    nextCalled = true;
  };

  middleware(req1, res1, next1);

  assert.strictEqual(responseStatus, 400);
  assert.strictEqual(responseBody.error, "BAD_REQUEST");
  assert.strictEqual(responseBody.message, "O campo 'age' deve ser do tipo 'number'.");
  assert.strictEqual(responseBody.requestId, "req-123");
  assert.strictEqual(nextCalled, false);

  // Test Case 2: Correct types (should sanitise string, call next)
  const req2 = {
    body: {
      username: "<script>dangerous</script>",
      age: 25,
    },
    originalUrl: "/test-route",
    headers: {
      "x-request-id": "req-456",
    },
  } as any;

  responseStatus = 0;
  responseBody = null;
  nextCalled = false;

  middleware(req2, res1, () => {
    nextCalled = true;
  });

  assert.strictEqual(responseStatus, 0); // No error status set
  assert.strictEqual(nextCalled, true);
  assert.strictEqual(req2.body.username, "&lt;script&gt;dangerous&lt;&#x2F;script&gt;"); // sanitised
});
