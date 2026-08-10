import { supabase } from "../config/supabase.js";
import { extractMetadataFromText } from "../services/context-builder.service.js";
import { env } from "../config/env.js";

// Representative terms to search for
const CPM_TERMS = ["deserção", "artigo 187", "abandono de posto", "insubordinação"];
const RDPM_TERMS = ["processo administrativo disciplinar", "sindicância", "transgressão disciplinar", "artigo 53"];

function normalizeText(text: string): string {
  if (!text) return "";
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove accents
    .replace(/[._\-]/g, " ") // replace dots, underscores, and dashes with spaces
    .replace(/\s+/g, " ")
    .trim();
}

export interface InspectionResult {
  documentName: string;
  totalPages: number;
  extractedChars: number;
  totalChunks: number;
  totalEmbeddings: number;
  firstChunks: Array<{
    chunkId: string;
    page: number;
    article: string;
    textPreview: string;
  }>;
  searchResults: Array<{
    term: string;
    found: boolean;
    chunkId?: string;
    chunkIndex?: number;
    page?: number;
    score?: number;
    matchingChunkText?: string;
  }>;
}

/**
 * Main inspection logic that executes exclusively against the real Supabase database.
 */
export async function inspectDocument(docQuery: string): Promise<InspectionResult | null> {
  // Check if environment variables are available and not mock values
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY === "dummy_key") {
    throw new Error("Erro: Chave de API do Supabase não configurada ou inválida. Não é possível inspecionar a base de dados real.");
  }

  // 1. Fetch matching document from knowledge_documents
  const { data: documents, error: docError } = await supabase
    .from("knowledge_documents")
    .select("*");

  if (docError) {
    throw new Error(`Erro ao buscar documentos da base real: ${docError.message}`);
  }

  const queryNorm = normalizeText(docQuery);
  // Find the best match by checking if the normalized file name contains our query or vice versa
  const docData = documents?.find((doc: any) => {
    const docNorm = normalizeText(doc.file_name);
    return docNorm.includes(queryNorm) || queryNorm.includes(docNorm) ||
      (queryNorm === "cpm" && docNorm.includes("codigo penal militar")) ||
      (queryNorm === "rdpm" && docNorm.includes("regulamento disciplinar"));
  });

  if (!docData) {
    return null;
  }

  // 2. Fetch all chunks of the found document
  const { data: chunks, error: chunkError } = await supabase
    .from("knowledge_chunks")
    .select("*")
    .eq("document_id", docData.id)
    .order("chunk_index", { ascending: true });

  if (chunkError) {
    throw new Error(`Erro ao buscar chunks do documento "${docData.file_name}": ${chunkError.message}`);
  }

  // Parse chunks to extract text and metadata
  const parsedChunks = (chunks || []).map((c: any) => {
    let cleanText = c.content ?? "";
    let metadata: any = {};
    const metaMatch = cleanText.match(/^\[METADATA:([\s\S]*?)\]\n([\s\S]*)$/);
    if (metaMatch) {
      try {
        metadata = JSON.parse(metaMatch[1]);
      } catch (e) {
        // Ignore JSON parse errors
      }
      cleanText = metaMatch[2] ?? "";
    }
    const metaText = extractMetadataFromText(cleanText);
    return {
      id: c.id,
      chunkIndex: c.chunk_index ?? 0,
      text: cleanText.trim(),
      page: metadata.pageNumber ?? 1,
      article: metaText.article || "N/A"
    };
  });

  // Calculate total pages
  const pagesSet = new Set(parsedChunks.map(pc => pc.page));
  const totalPages = pagesSet.size > 0 ? Math.max(...Array.from(pagesSet)) : 1;

  // Compile first 20 chunks
  const first20 = parsedChunks.slice(0, 20).map(pc => ({
    chunkId: pc.id,
    page: pc.page,
    article: pc.article,
    textPreview: pc.text.substring(0, 500)
  }));

  // Determine which terms to search based on filename
  const isCPM = docData.file_name.toLowerCase().includes("militar") || docData.file_name.toLowerCase().includes("cpm");
  const searchTerms = isCPM ? CPM_TERMS : RDPM_TERMS;

  const searchResults = searchTerms.map(term => {
    const termNorm = normalizeText(term);

    // Look for exact/substring match in all parsed chunks of this document
    let foundChunk: any = null;
    let highestScore = 0;

    for (const pc of parsedChunks) {
      const pcNorm = normalizeText(pc.text);
      if (pcNorm.includes(termNorm)) {
        foundChunk = pc;
        highestScore = 1.0; // exact text match found
        break;
      }
    }

    if (foundChunk) {
      return {
        term,
        found: true,
        chunkId: foundChunk.id,
        chunkIndex: foundChunk.chunkIndex,
        page: foundChunk.page,
        score: highestScore,
        matchingChunkText: foundChunk.text
      };
    } else {
      return {
        term,
        found: false
      };
    }
  });

  return {
    documentName: docData.file_name,
    totalPages,
    extractedChars: docData.extracted_chars ?? 0,
    totalChunks: docData.total_chunks ?? (chunks || []).length,
    totalEmbeddings: docData.total_embeddings ?? (chunks || []).length,
    firstChunks: first20,
    searchResults
  };
}

/**
 * Runner function for the CLI
 */
async function run() {
  const docArg = process.argv.slice(2).join(" ");
  if (!docArg) {
    console.log("======================================================================");
    console.log("INSPEÇÃO VAZIA: Por favor, forneça o nome do documento.");
    console.log("Exemplo: npm run rag:inspect \"Código Penal Militar\"");
    console.log("     ou: npm run rag:inspect \"RDPM\"");
    console.log("======================================================================\n");

    console.log("Executando inspeção padrão para ambos os documentos...\n");
    await performAndPrintInspection("Código Penal Militar");
    console.log("\n" + "=".repeat(80) + "\n");
    await performAndPrintInspection("RDPM");
    return;
  }

  await performAndPrintInspection(docArg);
}

async function performAndPrintInspection(docQuery: string) {
  console.log(`======================================================================`);
  console.log(`AUDITORIA E INSPEÇÃO DE CONTEÚDO INDEXADO: "${docQuery}"`);
  console.log(`======================================================================\n`);

  try {
    const result = await inspectDocument(docQuery);

    if (!result) {
      console.log(`[ERRO] Nenhum documento correspondente a "${docQuery}" foi encontrado na base indexada.`);
      console.log("Por favor, certifique-se de que o documento foi carregado e indexado com sucesso.");
      return;
    }

    console.log(`Documento:`);
    console.log(`- Nome: ${result.documentName}`);
    console.log(`- Número de páginas: ${result.totalPages}`);
    console.log(`- Caracteres extraídos: ${result.extractedChars}`);
    console.log(`- Número de chunks: ${result.totalChunks}`);
    console.log(`- Número de embeddings: ${result.totalEmbeddings}`);
    console.log(`\n----------------------------------------------------------------------`);
    console.log(`Para os primeiros 20 chunks:\n`);

    if (result.firstChunks.length === 0) {
      console.log("Nenhum chunk disponível para visualização.");
    } else {
      result.firstChunks.forEach((c, idx) => {
        console.log(`[Chunk ${idx + 1}]`);
        console.log(`  - chunk_id: ${c.chunkId}`);
        console.log(`  - página: ${c.page}`);
        console.log(`  - artigo: ${c.article}`);
        console.log(`  - primeiros 500 caracteres: "${c.textPreview.replace(/\n/g, " ")}..."`);
        console.log();
      });
    }

    console.log(`----------------------------------------------------------------------`);
    console.log(`Busca explícita de termos-chave:\n`);

    result.searchResults.forEach(res => {
      console.log(`Termo: "${res.term}"`);
      console.log(`  - encontrado?: ${res.found ? "SIM" : "NÃO"}`);

      if (res.found) {
        console.log(`  - em qual chunk?: ID: ${res.chunkId} (Índice: ${res.chunkIndex})`);
        console.log(`  - página?: ${res.page}`);
        console.log(`  - score?: ${res.score?.toFixed(4)}`);
        console.log(`  - O texto existe na base?: SIM`);
        console.log(`  - Chunk completo:\n${"=".repeat(40)}\n${res.matchingChunkText}\n${"=".repeat(40)}`);
      } else {
        console.log(`  - O texto existe na base?: NÃO`);
        console.log(`  - O texto existe na base?: A indexação não contém esse conteúdo.`);
      }
      console.log();
    });

  } catch (error: any) {
    console.error(`Ocorreu um erro ao realizar a inspeção do documento: ${error.message || error}`);
  }
}

// Execute if run directly from command line
if (
  process.argv[1]?.endsWith("inspect-rag.ts") ||
  process.argv[1]?.endsWith("inspect-rag.js") ||
  process.argv.includes("--run-inspection-directly")
) {
  run().catch(err => {
    console.error("Erro fatal no script de inspeção:", err);
    process.exit(1);
  });
}
