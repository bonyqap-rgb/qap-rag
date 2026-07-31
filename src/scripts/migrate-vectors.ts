import { env } from "../config/env.js";
import { DocumentService } from "../services/document.service.js";

/**
 * Programmatic migration of vectors to Voyage AI 1536-dimensional space.
 * Identifies all indexed documents, regenerates embeddings, and persists them.
 */
export async function runMigration(): Promise<{ success: boolean; migratedCount: number; errors: any[] }> {
  console.log("=== INICIANDO MIGRAÇÃO VETORIAL COM VOYAGE AI ===");

  if (!env.VOYAGE_API_KEY) {
    const errMsg = "A variável de ambiente VOYAGE_API_KEY não está configurada. A migração requer o Voyage AI.";
    console.error(`[MIGRATE VECTORS ERROR] ${errMsg}`);
    throw new Error(errMsg);
  }

  const documentService = new DocumentService();
  const docs = await documentService.listDocuments();
  const completedDocs = docs.filter(doc => doc.processingStatus === "completed");

  console.log(`[MIGRATE VECTORS] Documentos identificados para migração: ${completedDocs.length}`);
  const errors: any[] = [];
  let migratedCount = 0;

  for (const doc of completedDocs) {
    console.log(`\n[MIGRATE VECTORS] Migrando documento: "${doc.title}" (ID: ${doc.id}, Arquivo: ${doc.filename})...`);
    try {
      const result = await documentService.reindexDocument(doc.id);
      if (result.success) {
        migratedCount++;
        console.log(`[MIGRATE VECTORS] Sucesso! Chunks migrados: ${result.chunksCount} em ${result.durationMs}ms`);
      } else {
        const message = result.message || "Erro desconhecido durante reindexação";
        console.error(`[MIGRATE VECTORS] Falha no documento ${doc.filename}: ${message}`);
        errors.push({ id: doc.id, filename: doc.filename, error: message });
      }
    } catch (err: any) {
      const errMsg = err.message || String(err);
      console.error(`[MIGRATE VECTORS] Erro inesperado no documento ${doc.filename}:`, errMsg);
      errors.push({ id: doc.id, filename: doc.filename, error: errMsg });
    }
  }

  console.log("\n=== MIGRAÇÃO VETORIAL CONCLUÍDA ===");
  console.log(`[MIGRATE VECTORS] Sucesso: ${migratedCount} de ${completedDocs.length} documentos migrados.`);
  if (errors.length > 0) {
    console.log(`[MIGRATE VECTORS] Erros de migração detectados: ${errors.length}`);
  }

  return {
    success: errors.length === 0,
    migratedCount,
    errors
  };
}

// Self-execute if run directly or explicitly requested
if (
  process.argv[1]?.endsWith("migrate-vectors.ts") ||
  process.argv[1]?.endsWith("migrate-vectors.js") ||
  process.argv.includes("--run-migration-directly")
) {
  runMigration()
    .then((res) => {
      if (!res.success) {
        process.exit(1);
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error("[MIGRATE VECTORS FATAL]", err);
      process.exit(1);
    });
}
