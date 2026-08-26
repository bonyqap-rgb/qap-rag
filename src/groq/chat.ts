import dotenv from "dotenv";
import Groq from "groq-sdk";
import { env } from "../config/env.js";
import { groqChatCircuitBreaker } from "../services/circuit-breaker.service.js";
import { PromptBuilderService } from "../services/prompt-builder.service.js";

dotenv.config();

const groq = new Groq({
  apiKey: env.GROQ_API_KEY,
});

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Operação excedeu o tempo limite de " + timeoutMs + "ms"));
    }, timeoutMs);
    promise.then((res) => { clearTimeout(timer); resolve(res); }).catch((err) => { clearTimeout(timer); reject(err); });
  });
}

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
      if (attempt >= retries) throw error;
      const backoffDelay = delayMs * Math.pow(2, attempt - 1);
      console.warn(`[RETRY] Tentativa de Chat ${attempt} falhou. Retentando em ${backoffDelay}ms... Erro: ${error.message || error}`);
      await new Promise((resolve) => setTimeout(resolve, backoffDelay));
    }
  }
}

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
  if (!question || question.trim() === "") throw new Error("A pergunta não pode ser vazia.");

  const systemPrompt = options.systemPrompt || PromptBuilderService.buildSystemPrompt();
  const userPrompt = options.userPrompt || `CONTEXTO DE SUPORTE:\n${context || "Nenhum contexto encontrado."}\n\nPERGUNTA:\n${question}`;

  // Groq shut down the old Llama/Mixtral models used by this project.
  // Only use the current production model or the centrally configured model.
  const allowedModels = [
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
    "qwen/qwen3.6-27b",
    "llama-3.3-70b-versatile",
  ];
  let model = options.model || env.DEFAULT_CHAT_MODEL;
  if (!allowedModels.includes(model) || model === "llama-3.3-70b-versatile") {
    console.warn(`[MODEL FALLBACK] Modelo '${model}' não está disponível. Utilizando '${env.DEFAULT_CHAT_MODEL}'.`);
    model = env.DEFAULT_CHAT_MODEL;
  }

  const temperature = options.temperature !== undefined ? options.temperature : 0;
  const timeoutLimit = options.timeout || env.LLM_TIMEOUT;
  const retryCount = options.retries !== undefined ? options.retries : env.LLM_RETRIES;

  const apiCall = () => withTimeout(
    groq.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature,
    }),
    timeoutLimit
  );

  const response = await groqChatCircuitBreaker.execute(() =>
    retryWithBackoff(apiCall, retryCount, env.LLM_RETRY_DELAY)
  );

  const answer = response.choices?.[0]?.message?.content;
  if (!answer) throw new Error("O Groq retornou uma resposta vazia.");
  return answer.trim();
}

let chatImplementation = defaultChatImplementation;

export function setChatImplementation(fn: typeof defaultChatImplementation) {
  chatImplementation = fn;
}

export function resetChatImplementation() {
  chatImplementation = defaultChatImplementation;
}

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
  return chatImplementation(question, context, options);
}

export async function chatWithContext(question: string, context: string): Promise<string> {
  return chatWithContextConfigurable(question, context);
}
