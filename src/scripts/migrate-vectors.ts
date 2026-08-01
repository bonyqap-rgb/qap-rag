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
  const result = await documentService.reindexAllCompletedDocuments();

  return {
    success: result.success,
    migratedCount: result.documentsProcessed,
    errors: result.errors
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
