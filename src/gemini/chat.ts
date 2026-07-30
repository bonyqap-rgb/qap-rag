import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { env } from "../config/env.js";
import { chatCircuitBreaker } from "../services/circuit-breaker.service.js";

dotenv.config();

const ai = new GoogleGenAI({
  apiKey: env.GEMINI_API_KEY,
});

/**
 * Performs a promise with timeout capability.
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Operação excedeu o tempo limite de " + timeoutMs + "ms"));
    }, timeoutMs);

    promise
      .then((res) => {
        clearTimeout(timer);
        resolve(res);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

/**
 * Executes a function with exponential backoff retries for transient failures.
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  retries = env.LLM_RETRIES,
  delayMs = env.LLM_RETRY_DELAY
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error: any) {
      attempt++;
      if (attempt >= retries) {
        throw error;
      }
      const backoffDelay = delayMs * Math.pow(2, attempt - 1);
      console.warn(`[RETRY] Tentativa de Chat ${attempt} falhou. Retentando em ${backoffDelay}ms... Erro: ${error.message || error}`);
      await new Promise((resolve) => setTimeout(resolve, backoffDelay));
    }
  }
}

/**
 * Default internal implementation for chat completion.
 */
async function defaultChatImplementation(
  question: string,
  context: string,
  options: {
    model?: string;
    temperature?: number;
    timeout?: number;
    retries?: number;
    systemPrompt?: string;
    userPrompt?: string;
  } = {}
): Promise<string> {
  if (!question || question.trim() === "") {
    throw new Error("A pergunta não pode ser vazia.");
  }

  const systemPrompt = options.systemPrompt || `Você é um especialista da Polícia Militar do Estado de São Paulo.

Responda a pergunta do usuário baseando-se EXCLUSIVAMENTE no CONTEXTO fornecido abaixo.

Se a resposta não puder ser encontrada no contexto fornecido, responda exatamente e sem explicações adicionais:
"Não encontrei essa informação na base de conhecimento."

Ao responder, faça referências explícitas às fontes do contexto utilizadas (por exemplo: "[doc: documento.pdf, pág: 3]").`;

  const userPrompt = options.userPrompt || `CONTEXTO DE SUPORTE:
${context || "Nenhum contexto encontrado."}

PERGUNTA:
${question}`;

  const model = options.model || env.DEFAULT_CHAT_MODEL;
  const temperature = options.temperature !== undefined ? options.temperature : 0;
  const timeoutLimit = options.timeout || env.LLM_TIMEOUT;
  const retryCount = options.retries !== undefined ? options.retries : env.LLM_RETRIES;

  const apiCall = () =>
    withTimeout(
      ai.models.generateContent({
        model,
        contents: userPrompt,
        config: {
          systemInstruction: systemPrompt,
          temperature,
        },
      }),
      timeoutLimit
    );

  const response = await chatCircuitBreaker.execute(() =>
    retryWithBackoff(apiCall, retryCount, env.LLM_RETRY_DELAY)
  );

  const answer = response.text;

  if (!answer) {
    throw new Error("O Gemini retornou uma resposta vazia.");
  }

  return answer.trim();
}

// Live binding/re-assignment container for tests in ESM
let chatImplementation = defaultChatImplementation;

export function setChatImplementation(fn: typeof defaultChatImplementation) {
  chatImplementation = fn;
}

export function resetChatImplementation() {
  chatImplementation = defaultChatImplementation;
}

/**
 * Highly configurable chat completion function interfacing with OpenRouter/Gemini.
 */
export async function chatWithContextConfigurable(
  question: string,
  context: string,
  options: {
    model?: string;
    temperature?: number;
    timeout?: number;
    retries?: number;
    systemPrompt?: string;
    userPrompt?: string;
  } = {}
): Promise<string> {
  let model = options.model && !options.model.includes("openai") && !options.model.includes("openrouter") ? options.model : env.DEFAULT_CHAT_MODEL;
  if (model.includes("gemini-2.5")) {
    model = env.DEFAULT_CHAT_MODEL;
  }
  return chatImplementation(question, context, { ...options, model });
}

/**
 * Interacts with the LLM via OpenRouter to complete a prompt with context.
 * Strictly instructs the model to only use the retrieved context, and reference sources explicitly.
 * Backward compatible wrapper over chatWithContextConfigurable.
 *
 * @param question - The user's question
 * @param context - Formatted contextual documents with metadata tags
 * @returns The generated response string
 */
export async function chatWithContext(
  question: string,
  context: string
): Promise<string> {
  return chatWithContextConfigurable(question, context);
}
