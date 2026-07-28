import { Router, Request, Response, NextFunction } from "express";
import { createEmbedding } from "../gemini/embed.js";
import { searchKnowledge, SearchResult } from "../vector/search.js";
import { chatWithContext } from "../gemini/chat.js";

const router = Router();

router.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { question } = req.body;

    if (!question) {
      return res.status(400).json({
        success: false,
        error: "Pergunta não informada.",
      });
    }

    // 1. Geração do embedding da pergunta (utiliza cache automático interno e retentativas)
    const embedding = await createEmbedding(question);

    // 2. Busca vetorial com desduplicação e limite de relevância (> 0.3)
    const documents: SearchResult[] = await searchKnowledge(embedding, 5, 0.3);

    // 3. Processamento de metadados e limpeza do contexto
    const retrievedSources: string[] = [];
    const pageNumbers: number[] = [];
    const retrievedChunkIdentifiers: string[] = [];
    let formattedContexts: string[] = [];
    let totalSimilarity = 0;

    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i];
      totalSimilarity += doc.similarity;

      let cleanText = doc.content;
      let meta = {
        sourceDocument: "Documento Desconhecido",
        pageNumber: 1,
        chunkIndex: doc.chunk_index,
        totalChunks: 1,
      };

      // Tenta extrair os metadados embutidos de forma retrocompatível
      const metaMatch = doc.content.match(/^\[METADATA:([\s\S]*?)\]\n([\s\S]*)$/);
      if (metaMatch) {
        try {
          meta = JSON.parse(metaMatch[1]);
          cleanText = metaMatch[2].trim();
        } catch (e) {
          console.warn("[METADATA PARSE ERROR] Falha ao ler metadados do trecho, utilizando padrão.");
        }
      }

      // Popula listas de retorno de forma desduplicada
      if (meta.sourceDocument && !retrievedSources.includes(meta.sourceDocument)) {
        retrievedSources.push(meta.sourceDocument);
      }
      if (meta.pageNumber && !pageNumbers.includes(meta.pageNumber)) {
        pageNumbers.push(meta.pageNumber);
      }

      const chunkId = `${doc.document_id || "doc"}_chunk_${doc.chunk_index}`;
      retrievedChunkIdentifiers.push(chunkId);

      // Constrói contexto enriquecido e estruturado para o Gemini referenciar
      formattedContexts.push(
        `[Fonte: ${meta.sourceDocument}, Página: ${meta.pageNumber}, Bloco: ${meta.chunkIndex}]\n${cleanText}`
      );
    }

    // 4. Cálculo do score de confiança (média de similaridade dos documentos retornados)
    const confidenceScore = documents.length > 0 ? totalSimilarity / documents.length : 0.0;

    const context = formattedContexts.join("\n\n");

    // 5. Geração da resposta contextualizada via OpenRouter GPT-4.1-mini
    const answer = await chatWithContext(question, context);

    // Retorna a resposta contendo tanto os novos campos obrigatórios quanto os de retrocompatibilidade
    return res.json({
      success: true,
      answer,
      documents: documents.length,
      confidenceScore,
      retrievedSources,
      pageNumbers: pageNumbers.sort((a, b) => a - b),
      retrievedChunkIdentifiers,
    });

  } catch (error) {
    next(error);
  }
});

export default router;
