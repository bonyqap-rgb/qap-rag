import { DocumentRepository } from "../repositories/document.repository.js";
import { Document, DocumentProcessingStatus } from "../models/document.model.js";

export class ValidationError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends Error {
  status = 404;
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export class DocumentService {
  private repository: DocumentRepository;

  constructor(repository: DocumentRepository = new DocumentRepository()) {
    this.repository = repository;
  }

  /**
   * Validate fields of a document payload
   */
  private validatePayload(doc: Partial<Document>, isUpdate = false): void {
    const requiredFields: (keyof Document)[] = [
      "title",
      "category",
      "version",
      "source",
      "language",
      "filename",
      "fileSize",
      "mimeType",
      "totalPages"
    ];

    if (!isUpdate) {
      // Validate all required fields are present
      for (const field of requiredFields) {
        if (doc[field] === undefined || doc[field] === null || doc[field] === "") {
          throw new ValidationError(`O campo '${field}' é obrigatório.`);
        }
      }
    }

    // Validate title length if provided
    if (doc.title !== undefined) {
      if (typeof doc.title !== "string") {
        throw new ValidationError("O campo 'title' deve ser uma string.");
      }
      if (doc.title.trim().length === 0) {
        throw new ValidationError("O campo 'title' não pode estar vazio.");
      }
      if (doc.title.length > 255) {
        throw new ValidationError("O campo 'title' não pode exceder 255 caracteres.");
      }
    }

    // Validate version format if provided
    if (doc.version !== undefined) {
      if (typeof doc.version !== "string") {
        throw new ValidationError("O campo 'version' deve ser uma string.");
      }
      // Matches standard formats like "1.0", "1.0.0", "12.34.56"
      const versionRegex = /^\d+\.\d+(\.\d+)?$/;
      if (!versionRegex.test(doc.version)) {
        throw new ValidationError("O formato do campo 'version' é inválido. Use formatos como '1.0' ou '1.0.0'.");
      }
    }

    // Validate category if provided
    if (doc.category !== undefined) {
      if (typeof doc.category !== "string") {
        throw new ValidationError("O campo 'category' deve ser uma string.");
      }
      if (doc.category.trim().length === 0) {
        throw new ValidationError("O campo 'category' não pode estar vazio.");
      }
    }

    // Validate language if provided
    if (doc.language !== undefined) {
      if (typeof doc.language !== "string") {
        throw new ValidationError("O campo 'language' deve ser uma string.");
      }
      if (doc.language.trim().length === 0) {
        throw new ValidationError("O campo 'language' não pode estar vazio.");
      }
    }

    // Validate totalPages if provided
    if (doc.totalPages !== undefined) {
      if (typeof doc.totalPages !== "number" || isNaN(doc.totalPages) || doc.totalPages <= 0) {
        throw new ValidationError("O campo 'totalPages' deve ser um número inteiro positivo.");
      }
    }

    // Validate fileSize if provided
    if (doc.fileSize !== undefined) {
      if (typeof doc.fileSize !== "number" || isNaN(doc.fileSize) || doc.fileSize <= 0) {
        throw new ValidationError("O campo 'fileSize' deve ser um número inteiro positivo.");
      }
    }

    // Validate processingStatus if provided
    if (doc.processingStatus !== undefined) {
      const allowedStatus: DocumentProcessingStatus[] = ["pending", "processing", "completed", "failed"];
      if (!allowedStatus.includes(doc.processingStatus)) {
        throw new ValidationError("O campo 'processingStatus' deve ser 'pending', 'processing', 'completed' ou 'failed'.");
      }
    }
  }

  /**
   * Retrieves all documents
   */
  async listDocuments(): Promise<Document[]> {
    return this.repository.list();
  }

  /**
   * Retrieves a single document by ID or throws NotFoundError
   */
  async getDocumentById(id: string): Promise<Document> {
    if (!id) {
      throw new ValidationError("O ID do documento não foi informado.");
    }
    const doc = await this.repository.getById(id);
    if (!doc) {
      throw new NotFoundError(`Documento com ID '${id}' não encontrado.`);
    }
    return doc;
  }

  /**
   * Creates a new document after validating input metadata
   */
  async createDocument(docPayload: Omit<Document, "id" | "createdAt" | "updatedAt" | "processingStatus"> & { processingStatus?: DocumentProcessingStatus }): Promise<Document> {
    this.validatePayload(docPayload as any, false);

    const docToCreate = {
      ...docPayload,
      processingStatus: docPayload.processingStatus || "pending"
    };

    return this.repository.create(docToCreate);
  }

  /**
   * Updates an existing document's metadata after validating partial payload
   */
  async updateDocument(id: string, docPayload: Partial<Omit<Document, "id" | "createdAt" | "updatedAt" | "filename" | "fileSize" | "mimeType" | "totalPages">>): Promise<Document> {
    if (!id) {
      throw new ValidationError("O ID do documento não foi informado.");
    }

    this.validatePayload(docPayload, true);

    const updatedDoc = await this.repository.update(id, docPayload);
    if (!updatedDoc) {
      throw new NotFoundError(`Documento com ID '${id}' não encontrado.`);
    }

    return updatedDoc;
  }

  /**
   * Deletes a document or throws NotFoundError
   */
  async deleteDocument(id: string): Promise<void> {
    if (!id) {
      throw new ValidationError("O ID do documento não foi informado.");
    }
    const deleted = await this.repository.delete(id);
    if (!deleted) {
      throw new NotFoundError(`Documento com ID '${id}' não encontrado.`);
    }
  }
}
