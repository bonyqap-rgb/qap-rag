import { Router, Request, Response, NextFunction } from "express";
import { DocumentService } from "../services/document.service.js";
import { indexingHistoryService } from "../services/indexing-history.service.js";
import { logger } from "../services/logger.service.js";

const router = Router();
export const documentService = new DocumentService();

/**
 * GET /documents
 * Lists all documents.
 */
router.get("/", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const documents = await documentService.listDocuments();
    return res.status(200).json(documents);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /documents/stats
 * Retrieves statistics about the knowledge base.
 */
router.get("/stats", async (req: Request, res: Response, next: NextFunction) => {
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
router.get("/history", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const history = await indexingHistoryService.getHistory();
    return res.status(200).json(history);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /documents/:id/reindex
 * Reindexes an existing document by its ID (re-generating embeddings).
 */
router.post("/:id/reindex", async (req: Request, res: Response, next: NextFunction) => {
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
router.get("/:id", async (req: Request, res: Response, next: NextFunction) => {
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
router.post("/", async (req: Request, res: Response, next: NextFunction) => {
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
router.patch("/:id", async (req: Request, res: Response, next: NextFunction) => {
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
router.delete("/:id", async (req: Request, res: Response, next: NextFunction) => {
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
