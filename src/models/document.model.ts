export type DocumentProcessingStatus = "pending" | "processing" | "completed" | "failed" | "PENDENTE" | "PROCESSANDO" | "INDEXADO" | "INDEXAÇÃO_INVÁLIDA";

export interface Document {
  id?: string;
  title?: string;
  category?: string;
  version?: string;
  source?: string;
  language?: string;
  filename?: string;
  fileSize?: number;
  mimeType?: string;
  totalPages?: number;
  processingStatus?: DocumentProcessingStatus;
  status?: string;
  totalChunks?: number;
  total_chunks?: number;
  chunks?: number;
  totalEmbeddings?: number;
  total_embeddings?: number;
  extractedChars?: number;
  extracted_chars?: number;
  storagePath?: string;
  storage_path?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface DbDocument {
  id?: string;
  title?: string;
  file_name?: string;
  category?: string;
  version?: string;
  source?: string;
  language?: string;
  filename?: string;
  file_size?: number;
  mime_type?: string;
  total_pages?: number;
  processing_status?: DocumentProcessingStatus;
  status?: string;
  total_chunks?: number;
  total_embeddings?: number;
  extracted_chars?: number;
  storage_path?: string;
  created_at?: string;
  updated_at?: string;
}

/**
 * Maps a database representation of a document (snake_case) to the application representation (camelCase).
 */
export function mapDbToDocument(dbDoc: DbDocument): Document {
  const fileName = dbDoc?.file_name || dbDoc?.filename || dbDoc?.title || "";
  const rawStatus = dbDoc?.status || "INDEXADO";
  let procStatus: DocumentProcessingStatus = "completed";
  if (rawStatus === "INDEXADO") procStatus = "completed";
  else if (rawStatus === "PROCESSANDO") procStatus = "processing";
  else if (rawStatus === "INDEXAÇÃO_INVÁLIDA") procStatus = "failed";
  else if (rawStatus === "PENDENTE") procStatus = "pending";
  else if (dbDoc?.processing_status) procStatus = dbDoc.processing_status;

  const chunkCount = dbDoc?.total_chunks ?? 0;

  return {
    id: dbDoc?.id ?? "",
    title: fileName,
    category: dbDoc?.category ?? "Geral",
    version: dbDoc?.version ?? "1.0",
    source: dbDoc?.source ?? "Upload",
    language: dbDoc?.language ?? "pt-BR",
    filename: fileName,
    fileSize: dbDoc?.file_size ?? 1024,
    mimeType: dbDoc?.mime_type ?? "application/pdf",
    totalPages: dbDoc?.total_pages ?? 1,
    processingStatus: procStatus,
    status: rawStatus,
    totalChunks: chunkCount,
    total_chunks: chunkCount,
    chunks: chunkCount,
    totalEmbeddings: dbDoc?.total_embeddings ?? 0,
    total_embeddings: dbDoc?.total_embeddings ?? 0,
    extractedChars: dbDoc?.extracted_chars ?? 0,
    extracted_chars: dbDoc?.extracted_chars ?? 0,
    storagePath: dbDoc?.storage_path ?? "",
    storage_path: dbDoc?.storage_path ?? "",
    createdAt: dbDoc?.created_at ?? "",
    updatedAt: dbDoc?.updated_at || dbDoc?.created_at || "",
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
  if (doc.processingStatus !== undefined) dbDoc.processing_status = doc.processingStatus;
  if (doc.createdAt !== undefined) dbDoc.created_at = doc.createdAt;
  if (doc.updatedAt !== undefined) dbDoc.updated_at = doc.updatedAt;
  return dbDoc;
}
