import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY!,
  baseURL: "https://openrouter.ai/api/v1",
});

// Centralized system instructions to maintain consistency
const SYSTEM_INSTRUCTIONS = `Você é um especialista da Polícia Militar do Estado de São Paulo.

Responda SOMENTE utilizando o contexto fornecido.

Se a resposta não estiver no contexto, responda exatamente:

"Não encontrei essa informação na base de conhecimento."`;

/**
 * Sends a structured prompt to OpenRouter chat completion containing the contextual
 * segments extracted from similarity search to answer the user's question.
 *
 * @param question - The user's query
 * @param context - Combined context string retrieved from vector database search
 * @returns The assistant's response text string
 */
export async function chatWithContext(
  question: string,
  context: string
): Promise<string> {
  if (!question || question.trim() === "") {
    throw new Error("A pergunta do usuário não pode ser vazia.");
  }

  // Fallback to empty space context if none is available
  const activeContext = context ? context.trim() : "";

  // Structure prompt construction clearly
  const userContent = `CONTEXTO:\n\n${activeContext}\n\nPERGUNTA:\n\n${question.trim()}`;

  const completion = await client.chat.completions.create({
    model: "openai/gpt-4.1-mini",
    messages: [
      {
        role: "system",
        content: SYSTEM_INSTRUCTIONS,
      },
      {
        role: "user",
        content: userContent,
      },
    ],
    temperature: 0,
  });

  const answer = completion.choices[0]?.message?.content;

  if (!answer) {
    throw new Error("O OpenRouter não retornou resposta válida ou corpo de escolhas vazio.");
  }

  return answer.trim();
}
