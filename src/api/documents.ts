import { Router, Request, Response, NextFunction } from "express";
import { DocumentService } from "../services/document.service.js";
import { indexingHistoryService } from "../services/indexing-history.service.js";
import { logger } from "../services/logger.service.js";
import { env } from "../config/env.js";
import { indexRateLimiter, documentRateLimiter } from "../middlewares/rate-limit.middleware.js";

const router = Router();
export const documentService = new DocumentService();

/**
 * GET /documents
 * Lists all documents.
 */
router.get("/", documentRateLimiter, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const documents = await documentService.listDocuments();
    return res.status(200).json(documents);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /documents/statistics
 * Retrieves camelCase statistics about the knowledge base using only knowledge_documents and knowledge_chunks.
 */
router.get("/statistics", documentRateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  const start = performance.now();
  const requestId = req.headers["x-request-id"] as string;
  try {
    const stats = await documentService.getKnowledgeBaseStatistics();
    const duration = parseFloat((performance.now() - start).toFixed(2));

    logger.info("[ADMIN] Consulta de estatísticas (camelCase) realizada com sucesso", {
      requestId,
      duration,
      status: "success",
    });

    return res.status(200).json(stats);
  } catch (error) {
    const duration = parseFloat((performance.now() - start).toFixed(2));
    logger.error("[ADMIN] Falha ao consultar estatísticas (camelCase)", error, {
      requestId,
      duration,
      status: "error",
    });
    next(error);
  }
});

/**
 * GET /documents/stats
 * Retrieves statistics about the knowledge base.
 */
router.get("/stats", documentRateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  const start = performance.now();
  const requestId = req.headers["x-request-id"] as string;
  try {
    const stats = await documentService.getKnowledgeBaseStats();
    const duration = parseFloat((performance.now() - start).toFixed(2));

    logger.info("[ADMIN] Consulta de estatísticas realizada com sucesso", {
      requestId,
      duration,
      status: "success",
    });

    return res.status(200).json(stats);
  } catch (error) {
    const duration = parseFloat((performance.now() - start).toFixed(2));
    logger.error("[ADMIN] Falha ao consultar estatísticas", error, {
      requestId,
      duration,
      status: "error",
    });
    next(error);
  }
});

/**
 * GET /documents/history
 * Retrieves the complete indexing runs history.
 */
router.get("/history", documentRateLimiter, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const history = await indexingHistoryService.getHistory();
    return res.status(200).json(history);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /documents/reindex-all
 * Administrative endpoint to reindex all completed documents sequentially.
 * Protected by SUPABASE_SERVICE_ROLE_KEY.
 */
router.post("/reindex-all", indexRateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  const start = performance.now();
  const requestId = req.headers["x-request-id"] as string;

  // Protect endpoint
  const adminKey = req.headers["x-admin-key"] || req.headers["authorization"]?.replace("Bearer ", "");
  if (!adminKey || adminKey !== env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(401).json({
      error: "UNAUTHORIZED",
      timestamp: new Date().toISOString(),
      message: "Acesso administrativo não autorizado. Token inválido ou ausente.",
      route: req.originalUrl || req.url,
      requestId
    });
  }

  try {
    const result = await documentService.reindexAllCompletedDocuments();
    const duration = parseFloat((performance.now() - start).toFixed(2));

    logger.info("[ADMIN] Reindexação em massa de documentos concluída com sucesso", {
      requestId,
      duration,
      status: "success",
      documentsProcessed: result.documentsProcessed,
      chunksProcessed: result.chunksProcessed,
    });

    return res.status(200).json({
      success: result.success,
      documentsProcessed: result.documentsProcessed,
      chunksProcessed: result.chunksProcessed,
      durationMs: result.durationMs,
      errors: result.errors
    });
  } catch (error) {
    const duration = parseFloat((performance.now() - start).toFixed(2));
    logger.error("[ADMIN] Falha crítica na reindexação em massa de documentos", error, {
      requestId,
      duration,
      status: "error",
    });
    next(error);
  }
});

/**
 * POST /documents/:id/reindex
 * Reindexes an existing document by its ID (re-generating embeddings).
 */
router.post("/:id/reindex", indexRateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  const start = performance.now();
  const requestId = req.headers["x-request-id"] as string;
  try {
    const result = await documentService.reindexDocument(req.params.id as string);
    const duration = parseFloat((performance.now() - start).toFixed(2));

    logger.info("[ADMIN] Documento reindexado com sucesso", {
      requestId,
      duration,
      status: "success",
      documentId: req.params.id,
    });

    return res.status(200).json(result);
  } catch (error) {
    const duration = parseFloat((performance.now() - start).toFixed(2));
    logger.error("[ADMIN] Falha ao reindexar documento", error, {
      requestId,
      duration,
      status: "error",
      documentId: req.params.id,
    });
    next(error);
  }
});

/**
 * GET /documents/:id
 * Retrieves a single document by ID.
 */
router.get("/:id", documentRateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const document = await documentService.getDocumentById(req.params.id as string);
    return res.status(200).json(document);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /documents
 * Creates a new document metadata.
 */
router.post("/", indexRateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const createdDoc = await documentService.createDocument(req.body);
    return res.status(201).json(createdDoc);
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /documents/:id
 * Updates an existing document metadata.
 */
router.patch("/:id", indexRateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const updatedDoc = await documentService.updateDocument(req.params.id as string, req.body);
    return res.status(200).json(updatedDoc);
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /documents/:id
 * Deletes a document by ID.
 */
router.delete("/:id", indexRateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  const start = performance.now();
  const requestId = req.headers["x-request-id"] as string;
  try {
    await documentService.deleteDocument(req.params.id as string);
    const duration = parseFloat((performance.now() - start).toFixed(2));

    logger.info("[ADMIN] Exclusão de documento concluída com sucesso", {
      requestId,
      duration,
      status: "success",
      documentId: req.params.id,
    });

    return res.status(200).json({
      success: true,
      message: "Documento excluído com sucesso."
    });
  } catch (error) {
    const duration = parseFloat((performance.now() - start).toFixed(2));
    logger.error("[ADMIN] Falha ao excluir documento", error, {
      requestId,
      duration,
      status: "error",
      documentId: req.params.id,
    });
    next(error);
  }
});

export default router;
