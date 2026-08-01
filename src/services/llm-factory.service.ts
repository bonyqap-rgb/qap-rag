import Groq from "groq-sdk";
import { env } from "../config/env.js";

export type LLMProvider = "groq" | "gemini";

export class LlmFactoryService {
  private static groqClient: Groq | null = null;

  /**
   * Decides which provider to use based on env variables.
   * If GROQ_API_KEY is present, it MUST exclusively use "groq".
   */
  static getProvider(): LLMProvider {
    if (env.GROQ_API_KEY) {
      return "groq";
    }
    if (process.env.GEMINI_API_KEY) {
      return "gemini";
    }
    return "groq"; // Default fallback
  }

  /**
   * Returns the appropriate model based on provider and configurations.
   */
  static getModel(): string {
    const provider = this.getProvider();
    if (provider === "groq") {
      return env.DEFAULT_CHAT_MODEL;
    }
    return process.env.GEMINI_CHAT_MODEL || "gemini-1.5-pro";
  }

  /**
   * Gets or instantiates the Groq client.
   */
  static getGroqClient(): Groq {
    if (!this.groqClient) {
      this.groqClient = new Groq({
        apiKey: env.GROQ_API_KEY,
      });
    }
    return this.groqClient;
  }

  /**
   * Unified chat completion interface that routes request to the correct LLM provider.
   */
  static async chatComplete(
    messages: { role: "system" | "user"; content: string }[],
    options: { model?: string; temperature?: number } = {}
  ): Promise<string> {
    const provider = this.getProvider();
    let model = options.model || this.getModel();
    const temperature = options.temperature !== undefined ? options.temperature : 0;

    // Enforce Groq model fallback/validation if provider is groq
    if (provider === "groq") {
      const allowedModels = [env.DEFAULT_CHAT_MODEL, "llama3-8b-8192", "llama3-70b-8192", "mixtral-8x7b-32768", "gemma2-9b-it"];
      if (!allowedModels.includes(model)) {
        model = env.DEFAULT_CHAT_MODEL;
      }
    }

    // [REQUIRED LOGS] Log Provider and Model before each generation
    console.log(`Provider: ${provider}`);
    console.log(`Model: ${model}`);

    if (provider === "groq") {
      const client = this.getGroqClient();
      const response = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: messages.find(m => m.role === "system")?.content || "" },
          { role: "user", content: messages.find(m => m.role === "user")?.content || "" },
        ],
        temperature,
      });
      const content = response.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error("O Groq retornou uma resposta vazia.");
      }
      return content.trim();
    } else if (provider === "gemini") {
      throw new Error("O provedor Gemini está indisponível neste ambiente. O backend exige uso exclusivo do Groq quando GROQ_API_KEY está configurada.");
    } else {
      throw new Error("Provedor de LLM inválido ou não configurado.");
    }
  }
}
