import { test } from "node:test";
import assert from "node:assert";
import { chatWithContextConfigurable, setChatImplementation, resetChatImplementation } from "./chat.js";
import { env } from "../config/env.js";

test("Gemini Chat - Uses DEFAULT_CHAT_MODEL config by default", async () => {
  let resolvedModel = "";
  setChatImplementation(async (question, context, options) => {
    resolvedModel = options?.model || "";
    return "Mocked response";
  });

  try {
    await chatWithContextConfigurable("hello", "context");
    assert.strictEqual(resolvedModel, env.DEFAULT_CHAT_MODEL);
  } finally {
    resetChatImplementation();
  }
});

test("Gemini Chat - Overrides gemini-2.5 models with DEFAULT_CHAT_MODEL", async () => {
  let resolvedModel = "";
  setChatImplementation(async (question, context, options) => {
    resolvedModel = options?.model || "";
    return "Mocked response";
  });

  try {
    // Should override gemini-2.5-flash
    await chatWithContextConfigurable("hello", "context", { model: "gemini-2.5-flash" });
    assert.strictEqual(resolvedModel, env.DEFAULT_CHAT_MODEL);

    // Should override models/gemini-2.5-flash
    await chatWithContextConfigurable("hello", "context", { model: "models/gemini-2.5-flash" });
    assert.strictEqual(resolvedModel, env.DEFAULT_CHAT_MODEL);

    // Should override gemini-2.5-pro
    await chatWithContextConfigurable("hello", "context", { model: "gemini-2.5-pro" });
    assert.strictEqual(resolvedModel, env.DEFAULT_CHAT_MODEL);

    // Should allow other models (like gemini-2.0-flash or custom ones)
    await chatWithContextConfigurable("hello", "context", { model: "gemini-2.0-flash" });
    assert.strictEqual(resolvedModel, "gemini-2.0-flash");
  } finally {
    resetChatImplementation();
  }
});
