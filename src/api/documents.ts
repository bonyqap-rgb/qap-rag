import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { DocumentService, ValidationError } from "../services/document.service.js";

const router = Router();
export const documentService = new DocumentService();

// Configure multer memory storage with 50MB file size limit
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024 // 50 MB
  }
}).single("file");

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
 * POST /documents/:id/process
 * Synchronously processes a pending document: extracts text, counts pages, and updates status.
 */
router.post("/:id/process", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const processedDoc = await documentService.processDocument(req.params.id as string);
    return res.status(200).json(processedDoc);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /documents/upload
 * Uploads a PDF file, preserves metadata, stores it in storage/documents, and registers it.
 */
router.post("/upload", (req: Request, res: Response, next: NextFunction) => {
  upload(req, res, async (err: any) => {
    try {
      if (err) {
        if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
          throw new ValidationError("O arquivo excede o limite de tamanho de 50 MB.");
        }
        throw err;
      }

      // Validate empty uploads
      if (!req.file) {
        throw new ValidationError("Nenhum arquivo enviado.");
      }

      if (req.file.size === 0) {
        throw new ValidationError("O arquivo enviado está vazio.");
      }

      // Validate MIME type and file extension
      const ext = path.extname(req.file.originalname).toLowerCase();
      if (req.file.mimetype !== "application/pdf" || ext !== ".pdf") {
        throw new ValidationError("Apenas arquivos PDF são permitidos.");
      }

      // Generate a unique filename
      const uniqueFilename = `${crypto.randomUUID()}${ext}`;
      const targetDir = path.join("storage", "documents");
      const targetPath = path.join(targetDir, uniqueFilename);

      // Create storage directory if it doesn't exist
      fs.mkdirSync(targetDir, { recursive: true });

      // Save file to storage/documents
      await fs.promises.writeFile(targetPath, req.file.buffer);

      // Map request body variables with safe defaults (preserving original filename)
      let title = req.body.title || req.file.originalname;
      if (title.length > 255) {
        title = title.substring(0, 255);
      }

      const category = req.body.category || "Geral";
      const version = req.body.version || "1.0.0";
      const source = req.body.source || "Upload";
      const language = req.body.language || "pt-BR";
      const totalPages = req.body.totalPages ? parseInt(req.body.totalPages, 10) : 1;

      // Register the metadata in the documents table
      const createdDoc = await documentService.createDocument({
        title,
        category,
        version,
        source,
        language,
        filename: uniqueFilename, // Preserve unique filename in database
        fileSize: req.file.size,
        mimeType: req.file.mimetype,
        totalPages,
        processingStatus: "pending"
      });

      return res.status(201).json(createdDoc);
    } catch (error) {
      next(error);
    }
  });
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

export default router;
