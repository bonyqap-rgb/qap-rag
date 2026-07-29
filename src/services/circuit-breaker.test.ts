import { test } from "node:test";
import assert from "node:assert";
import { CircuitBreaker, CircuitState } from "./circuit-breaker.service.js";

test("CircuitBreaker - starts in CLOSED state", () => {
  const cb = new CircuitBreaker("TestBreaker", 3, 100);
  assert.strictEqual(cb.getState(), CircuitState.CLOSED);
});

test("CircuitBreaker - transitions to OPEN on failures threshold", async () => {
  const cb = new CircuitBreaker("TestBreaker", 2, 200);

  const failingCall = async () => {
    throw new Error("Failure");
  };

  // Attempt 1
  await assert.rejects(() => cb.execute(failingCall));
  assert.strictEqual(cb.getState(), CircuitState.CLOSED);

  // Attempt 2 - should trip the breaker
  await assert.rejects(() => cb.execute(failingCall));
  assert.strictEqual(cb.getState(), CircuitState.OPEN);

  // Attempt 3 - should fail fast with immediate rejection
  await assert.rejects(() => cb.execute(() => Promise.resolve("success")), /Circuito do serviço/);
});

test("CircuitBreaker - transitions to HALF_OPEN after cooldown", async () => {
  const cb = new CircuitBreaker("TestBreaker", 1, 100); // 100ms cooldown

  await assert.rejects(() => cb.execute(() => { throw new Error("fail"); }));
  assert.strictEqual(cb.getState(), CircuitState.OPEN);

  // Wait for cooldown
  await new Promise((resolve) => setTimeout(resolve, 120));

  assert.strictEqual(cb.getState(), CircuitState.HALF_OPEN);
});

test("CircuitBreaker - recovers to CLOSED on success in HALF_OPEN state", async () => {
  const cb = new CircuitBreaker("TestBreaker", 1, 100);

  await assert.rejects(() => cb.execute(() => { throw new Error("fail"); }));
  assert.strictEqual(cb.getState(), CircuitState.OPEN);

  // Wait for cooldown
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.strictEqual(cb.getState(), CircuitState.HALF_OPEN);

  // Success call
  const res = await cb.execute(() => Promise.resolve("recovered"));
  assert.strictEqual(res, "recovered");
  assert.strictEqual(cb.getState(), CircuitState.CLOSED);
});
