import { SupabaseClient } from "@supabase/supabase-js";
import { supabase as defaultSupabase } from "../config/supabase.js";
import { Document, DocumentProcessingStatus } from "../models/document.model.js";

function mapKnowledgeStatus(status: unknown): DocumentProcessingStatus {
  switch (String(status ?? "").toUpperCase()) {
    case "INDEXADO":
      return "completed";
    case "PROCESSANDO":
      return "processing";
    case "INDEXAÇÃO_INVÁLIDA":
    case "ERRO":
      return "failed";
    case "PENDENTE":
      return "pending";
    default:
      return "pending";
  }
}

export class DocumentRepository {
  private supabase: SupabaseClient;

  constructor(supabaseClient: SupabaseClient = defaultSupabase) {
    this.supabase = supabaseClient;
  }

  /**
   * List all documents sorted by creation date (descending).
   * The QAP RAG knowledge_documents table is the source of truth for
   * indexing status and chunk counters.
   */
  async list(): Promise<Document[]> {
    const { data, error } = await this.supabase
      .from("knowledge_documents")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    return (data || []).map((row: any) => ({
      id: row.id ?? "",
      title: row.file_name ?? "",
      category: "Geral",
      version: "1.0",
      source: "Upload",
      language: "pt-BR",
      filename: row.file_name ?? "",
      fileSize: row.file_size ?? 0,
      mimeType: row.mime_type ?? "application/pdf",
      totalPages: row.total_pages ?? 1,
      processingStatus: mapKnowledgeStatus(row.status),
      totalChunks: row.total_chunks ?? 0,
      createdAt: row.created_at ?? "",
      updatedAt: row.updated_at || row.created_at || "",
    } as Document & { totalChunks?: number }));
  }

  /**
   * Retrieve a document by its ID.
   */
  async getById(id: string): Promise<Document | null> {
    const { data, error } = await this.supabase
      .from("knowledge_documents")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    return {
      id: data.id ?? "",
      title: data.file_name ?? "",
      category: "Geral",
      version: "1.0",
      source: "Upload",
      language: "pt-BR",
      filename: data.file_name ?? "",
      fileSize: data.file_size ?? 0,
      mimeType: data.mime_type ?? "application/pdf",
      totalPages: data.total_pages ?? 1,
      processingStatus: mapKnowledgeStatus(data.status),
      totalChunks: data.total_chunks ?? 0,
      createdAt: data.created_at ?? "",
      updatedAt: data.updated_at || data.created_at || "",
    } as Document & { totalChunks?: number };
  }

  /**
   * Create document metadata.
   */
  async create(doc: Omit<Document, "id" | "createdAt" | "updatedAt"> & { id?: string }): Promise<Document> {
    const { data, error } = await this.supabase
      .from("knowledge_documents")
      .insert({
        id: doc.id,
        file_name: doc.filename,
      })
      .select()
      .single();

    if (error) throw error;

    return {
      id: data.id ?? "",
      title: data.file_name ?? "",
      category: "Geral",
      version: "1.0",
      source: "Upload",
      language: "pt-BR",
      filename: data.file_name ?? "",
      fileSize: data.file_size ?? 0,
      mimeType: data.mime_type ?? "application/pdf",
      totalPages: data.total_pages ?? 1,
      processingStatus: mapKnowledgeStatus(data.status),
      totalChunks: data.total_chunks ?? 0,
      createdAt: data.created_at ?? "",
      updatedAt: data.updated_at || data.created_at || "",
    } as Document & { totalChunks?: number };
  }

  /**
   * Update document metadata.
   */
  async update(
    id: string,
    _doc: Partial<Omit<Document, "id" | "createdAt" | "updatedAt" | "filename" | "fileSize" | "mimeType" | "totalPages">>
  ): Promise<Document | null> {
    const timestamp = new Date().toISOString();
    const { data, error } = await this.supabase
      .from("knowledge_documents")
      .update({ updated_at: timestamp })
      .eq("id", id)
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    return {
      id: data.id ?? "",
      title: data.file_name ?? "",
      category: "Geral",
      version: "1.0",
      source: "Upload",
      language: "pt-BR",
      filename: data.file_name ?? "",
      fileSize: data.file_size ?? 0,
      mimeType: data.mime_type ?? "application/pdf",
      totalPages: data.total_pages ?? 1,
      processingStatus: mapKnowledgeStatus(data.status),
      totalChunks: data.total_chunks ?? 0,
      createdAt: data.created_at ?? "",
      updatedAt: data.updated_at || data.created_at || "",
    } as Document & { totalChunks?: number };
  }

  /**
   * Delete a document by its ID.
   */
  async delete(id: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from("knowledge_documents")
      .delete()
      .eq("id", id)
      .select();

    if (error) throw error;
    return !!(data && data.length > 0);
  }
}
