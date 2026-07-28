import OpenAI from "openai";
import { env } from "../config/env.js";

const client = new OpenAI({
  apiKey: env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

export async function chatWithContext(
  question: string,
  context: string
): Promise<string> {
  const completion = await client.chat.completions.create({
    model: "openai/gpt-4.1-mini",
    messages: [
      {
        role: "system",
        content: `Você é um especialista da Polícia Militar do Estado de São Paulo.

Responda SOMENTE utilizando o contexto fornecido.

Se a resposta não estiver no contexto, responda exatamente:

"Não encontrei essa informação na base de conhecimento."`,
      },
      {
        role: "user",
        content: `CONTEXTO:

${context}

PERGUNTA:

${question}`,
      },
    ],
    temperature: 0,
  });

  const answer = completion.choices[0]?.message?.content;

  if (!answer) {
    throw new Error("O OpenRouter não retornou resposta.");
  }

  return answer.trim();
}
