import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY!,
  baseURL: "https://openrouter.ai/api/v1",
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
  retries = 3,
  delayMs = 1000
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

  const model = options.model || "openai/gpt-4.1-mini";
  const temperature = options.temperature !== undefined ? options.temperature : 0;
  const timeoutLimit = options.timeout || 25000;
  const retryCount = options.retries !== undefined ? options.retries : 3;

  const apiCall = () =>
    withTimeout(
      client.chat.completions.create({
        model,
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: userPrompt,
          },
        ],
        temperature,
      }),
      timeoutLimit
    );

  const completion = await retryWithBackoff(apiCall, retryCount, 1000);

  const answer = completion.choices[0]?.message?.content;

  if (!answer) {
    throw new Error("O OpenRouter retornou uma resposta em formato inválido ou vazia.");
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
  return chatImplementation(question, context, options);
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
