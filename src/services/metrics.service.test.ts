import { test } from "node:test";
import assert from "node:assert";
import { metricsService } from "./metrics.service.js";

test("MetricsService - increments and gets metrics correctly", () => {
  metricsService.reset();

  // Test initial state
  let current = metricsService.getMetrics();
  assert.strictEqual(current.numeroTotalRequisicoes, 0);
  assert.strictEqual(current.quantidadeErros, 0);
  assert.strictEqual(current.quantidadeChatsExecutados, 0);
  assert.strictEqual(current.quantidadeBuscasRAG, 0);
  assert.strictEqual(current.tempoMedioRequisicoesMs, 0);

  // Test increments
  metricsService.incrementRequests();
  metricsService.incrementErrors();
  metricsService.incrementChats();
  metricsService.incrementSearches();
  metricsService.addRequestTime(100);
  metricsService.addRequestTime(200);

  current = metricsService.getMetrics();
  assert.strictEqual(current.numeroTotalRequisicoes, 1);
  assert.strictEqual(current.quantidadeErros, 1);
  assert.strictEqual(current.quantidadeChatsExecutados, 1);
  assert.strictEqual(current.quantidadeBuscasRAG, 1);
  assert.strictEqual(current.tempoMedioRequisicoesMs, 150.00); // (100 + 200) / 2
});

test("MetricsService - reset clears stats correctly", () => {
  metricsService.reset();
  metricsService.incrementRequests();
  metricsService.reset();

  const current = metricsService.getMetrics();
  assert.strictEqual(current.numeroTotalRequisicoes, 0);
});
