import assert from "node:assert";
import { describe, it } from "node:test";
import { PromptBuilderService } from "./prompt-builder.service.js";

describe("PromptBuilderService", () => {
  it("should return system prompt containing article transcription guidelines", () => {
    const prompt = PromptBuilderService.buildSystemPrompt();
    assert.ok(prompt.includes('Quando o usuário perguntar pelo "conteúdo", "texto", "redação" ou "o que diz" de um artigo'));
    assert.ok(prompt.includes("Transcrever fielmente o texto do artigo existente no CONTEXTO."));
    assert.ok(prompt.includes("NÃO resumir."));
    assert.ok(prompt.includes("NÃO parafrasear."));
    assert.ok(prompt.includes("Preservar numeração, parágrafos e incisos."));
    assert.ok(prompt.includes("informar que a transcrição é parcial e reproduzir exatamente o trecho disponível"));
    assert.ok(prompt.includes("NUNCA inventar conteúdo."));
    assert.ok(prompt.includes("Para perguntas de explicação, interpretação ou resumo, você pode explicar, mas EXCLUSIVAMENTE com base no CONTEXTO."));
  });

  it("should build user prompt correctly", () => {
    const userPrompt = PromptBuilderService.buildUserPrompt("Qual o texto do artigo 31?", "Artigo 31 - Descrição...");
    assert.ok(userPrompt.includes("CONTEXTO DE SUPORTE:"));
    assert.ok(userPrompt.includes("Artigo 31 - Descrição..."));
    assert.ok(userPrompt.includes("PERGUNTA:"));
    assert.ok(userPrompt.includes("Qual o texto do artigo 31?"));
  });
});
