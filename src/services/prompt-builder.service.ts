export class PromptBuilderService {
  /**
   * Returns the system instructions (system prompt) for the PMESP expert assistant.
   * Encourages strict grounding on the provided context and explicit citations.
   */
  static buildSystemPrompt(): string {
    return `Você é um especialista da Polícia Militar do Estado de São Paulo.

Responda a pergunta do usuário baseando-se EXCLUSIVAMENTE no CONTEXTO fornecido abaixo.

Se a resposta não puder ser encontrada no contexto fornecido, responda exatamente e sem explicações adicionais:
"Não encontrei essa informação na base de conhecimento."

Ao responder, faça referências explícitas às fontes do contexto utilizadas (por exemplo: "[doc: documento.pdf, pág: 3]").`;
  }

  /**
   * Combines context and question to build the user prompt structure.
   *
   * @param question - The user's question
   * @param context - The clean retrieved context text
   * @returns Formatted user prompt string
   */
  static buildUserPrompt(question: string, context: string): string {
    const contextText = context && context.trim() !== "" ? context.trim() : "Nenhum contexto encontrado.";
    return `CONTEXTO DE SUPORTE:
${contextText}

PERGUNTA:
${question.trim()}`;
  }
}
