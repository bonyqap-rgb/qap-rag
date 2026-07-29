import { Router, Request, Response, NextFunction } from "express";
import { DocumentService } from "../services/document.service.js";
import { IndexerService } from "../services/indexer/indexer.service.js";

const router = Router();
export const documentService = new DocumentService();
const indexerService = new IndexerService();

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
  try {
    await documentService.deleteDocument(req.params.id as string);
    return res.status(200).json({
      success: true,
      message: "Documento excluído com sucesso."
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /documents/:id/index
 * Triggers the indexing pipeline for a specific document.
 */
router.post("/:id/index", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const documentId = req.params.id as string;
    await indexerService.indexDocument(documentId);
    return res.status(200).json({
      success: true,
      message: "Processo de indexação concluído com sucesso."
    });
  } catch (error) {
    next(error);
  }
});

export default router;
