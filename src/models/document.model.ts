export type DocumentProcessingStatus = "pending" | "processing" | "completed" | "failed";

export interface Document {
  id: string;
  title: string;
  category: string;
  version: string;
  source: string;
  language: string;
  filename: string;
  fileSize: number;
  mimeType: string;
  totalPages: number;
  extractedText?: string;
  processingStatus: DocumentProcessingStatus;
  createdAt: string;
  updatedAt: string;
}

export interface DbDocument {
  id: string;
  title: string;
  category: string;
  version: string;
  source: string;
  language: string;
  filename: string;
  file_size: number;
  mime_type: string;
  total_pages: number;
  extracted_text?: string;
  processing_status: DocumentProcessingStatus;
  created_at: string;
  updated_at: string;
}

/**
 * Maps a database representation of a document (snake_case) to the application representation (camelCase).
 */
export function mapDbToDocument(dbDoc: DbDocument): Document {
  return {
    id: dbDoc.id,
    title: dbDoc.title,
    category: dbDoc.category,
    version: dbDoc.version,
    source: dbDoc.source,
    language: dbDoc.language,
    filename: dbDoc.filename,
    fileSize: dbDoc.file_size,
    mimeType: dbDoc.mime_type,
    totalPages: dbDoc.total_pages,
    extractedText: dbDoc.extracted_text,
    processingStatus: dbDoc.processing_status,
    createdAt: dbDoc.created_at,
    updatedAt: dbDoc.updated_at,
  };
}

/**
 * Maps a partial application representation of a document (camelCase) to the database representation (snake_case).
 */
export function mapDocumentToDb(doc: Partial<Document>): Partial<DbDocument> {
  const dbDoc: Partial<DbDocument> = {};
  if (doc.id !== undefined) dbDoc.id = doc.id;
  if (doc.title !== undefined) dbDoc.title = doc.title;
  if (doc.category !== undefined) dbDoc.category = doc.category;
  if (doc.version !== undefined) dbDoc.version = doc.version;
  if (doc.source !== undefined) dbDoc.source = doc.source;
  if (doc.language !== undefined) dbDoc.language = doc.language;
  if (doc.filename !== undefined) dbDoc.filename = doc.filename;
  if (doc.fileSize !== undefined) dbDoc.file_size = doc.fileSize;
  if (doc.mimeType !== undefined) dbDoc.mime_type = doc.mimeType;
  if (doc.totalPages !== undefined) dbDoc.total_pages = doc.totalPages;
  if (doc.extractedText !== undefined) dbDoc.extracted_text = doc.extractedText;
  if (doc.processingStatus !== undefined) dbDoc.processing_status = doc.processingStatus;
  if (doc.createdAt !== undefined) dbDoc.created_at = doc.createdAt;
  if (doc.updatedAt !== undefined) dbDoc.updated_at = doc.updatedAt;
  return dbDoc;
}
