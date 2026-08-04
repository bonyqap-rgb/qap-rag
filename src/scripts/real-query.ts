import dotenv from "dotenv";
dotenv.config();

import { createEmbedding } from "../groq/embed.js";
import { SearchService } from "../services/search.service.js";
import { ContextBuilderService, extractMetadataFromText } from "../services/context-builder.service.js";
import { ChatService } from "../services/chat.service.js";
import { supabase } from "../config/supabase.js";

async function main() {
  const question = "Quais os prazos e fases do processo administrativo disciplinar militar?";

  console.log("=================================================");
  console.log("INICIANDO CONSULTA REAL DO PIPELINE /CHAT");
  console.log(`Pergunta: "${question}"`);
  console.log("=================================================");

  // 1. Embedding
  console.log("\nEmbedding");
  console.log("↓");
  let embedding: number[] = [];
  try {
    embedding = await createEmbedding(question);
    console.log(`Dimensão do Embedding: ${embedding.length}`);
    console.log(`Primeiros 10 valores: [${embedding.slice(0, 10).join(", ")}...]`);
  } catch (err: any) {
    console.error("Erro ao gerar embedding:", err.message || err);
    process.exit(1);
  }

  // 2. RPC utilizada
  console.log("\nRPC utilizada");
  console.log("↓");
  console.log("match_documents (com fallback para match_knowledge_chunks)");

  // 3. Execução da busca semântica exatamente como o pipeline
  const topK = 20;
  const scoreThreshold = 0.15;

  console.log(`\nExecutando busca vetorial com topK = ${topK} e scoreThreshold = ${scoreThreshold}...`);

  let searchResults: any[] = [];
  try {
    searchResults = await SearchService.search(question, topK, scoreThreshold);
  } catch (err: any) {
    console.error("Erro na busca vetorial:", err.message || err);
    process.exit(1);
  }

  // 4. Quantidade de resultados
  console.log("\nQuantidade de resultados");
  console.log("↓");
  const resultsCount = searchResults.length;
  console.log(resultsCount);

  if (resultsCount === 0) {
    console.log("\n[PARADA IMEDIATA] Retornou zero resultados. Parando imediatamente e descobrindo por quê.");

    // Diagnostic info
    try {
      const { count, error } = await supabase
        .from("knowledge_chunks")
        .select("*", { count: "exact", head: true });
      if (error) {
        console.log(`Erro ao consultar contagem no Supabase: ${error.message}`);
      } else {
        console.log(`Total de registros em 'knowledge_chunks' no banco: ${count}`);
      }
    } catch (dbErr: any) {
      console.log(`Erro de banco: ${dbErr.message}`);
    }
    console.log("Não seguindo para o LLM.");
    process.exit(0);
  }

  // 5. Top 20 scores
  console.log("\nTop 20 scores");
  console.log("↓");
  searchResults.slice(0, 20).forEach((res, idx) => {
    console.log(`Score ${idx + 1}: ${res.score.toFixed(4)}`);
  });

  // Load document filenames for displaying
  const docIds = Array.from(new Set(searchResults.map((r) => r.documentId)));
  const docMap = new Map<string, string>();
  if (docIds.length > 0) {
    try {
      const { data: matchedDocs } = await supabase
        .from("knowledge_documents")
        .select("id, file_name")
        .in("id", docIds);
      if (matchedDocs) {
        for (const d of matchedDocs) {
          docMap.set(d.id, d.file_name);
        }
      }
    } catch (err) {
      // ignore
    }
  }

  // 6. Chunks detalhados
  console.log("\nInformações detalhadas dos chunks:");
  console.log("=========================================");
  searchResults.forEach((res, idx) => {
    const filename = docMap.get(res.documentId) || "Desconhecido";
    const textVal = res.text ?? "";
    const meta = extractMetadataFromText(textVal);
    const resolvedPage = res.metadata?.pageNumber ?? "N/A";
    const resolvedArtigo = meta.article ?? "N/A";

    console.log(`\n--- Chunk ${idx + 1} ---`);
    console.log(`score: ${res.score.toFixed(4)}`);
    console.log(`documento: ${filename}`);
    console.log(`artigo: ${resolvedArtigo}`);
    console.log(`página: ${resolvedPage}`);
    console.log(`primeiros 500 caracteres: "${textVal.substring(0, 500).replace(/\n/g, " ")}..."`);
  });
  console.log("=========================================");

  // 7. Contexto enviado
  console.log("\nContexto enviado");
  console.log("↓");
  const chunksToProcess = searchResults.map(r => ({
    ...r,
    documentName: docMap.get(r.documentId) || r.metadata?.sourceDocument || "Desconhecido",
  }));
  const maxContextSize = 4000;
  const { context, selectedChunks } = ContextBuilderService.buildContextDetailed(chunksToProcess, maxContextSize);
  console.log(context);

  if (selectedChunks.length === 0) {
    console.log("\n[PARADA IMEDIATA] Nenhum chunk selecionado pelo construtor de contexto. Parando imediatamente.");
    process.exit(0);
  }

  // 8. Resposta do Groq
  console.log("\nResposta do Groq");
  console.log("↓");
  try {
    const chatResponse = await ChatService.chat(question, {
      topK,
      scoreThreshold,
    });
    console.log(chatResponse.answer);
  } catch (err: any) {
    console.error("Erro ao chamar Groq:", err.message || err);
  }

  console.log("\n=========================================");
  console.log("FIM DO REGISTRO");
  console.log("=========================================");
}

main().catch((err) => {
  console.error("Erro fatal no script:", err);
  process.exit(1);
});
