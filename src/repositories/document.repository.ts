import { SupabaseClient } from "@supabase/supabase-js";
import { supabase as defaultSupabase } from "../config/supabase.js";
import { Document } from "../models/document.model.js";

export class DocumentRepository {
  private supabase: SupabaseClient;

  constructor(supabaseClient: SupabaseClient = defaultSupabase) {
    this.supabase = supabaseClient;
  }

  /**
   * Map database row representation to the unified application Document model.
   */
  private mapRowToDocument(row: any): Document {
    let processingStatus: "pending" | "processing" | "completed" | "failed" = "completed";

    if (row.status === "PENDENTE") {
      processingStatus = "pending";
    } else if (row.status === "PROCESSANDO") {
      processingStatus = "processing";
    } else if (row.status === "INDEXADO") {
      processingStatus = "completed";
    } else if (row.status === "INDEXAÇÃO_INVÁLIDA") {
      processingStatus = "failed";
    }

    return {
      id: row.id ?? "",
      title: row.file_name ?? "",
      category: "Geral",
      version: "1.0",
      source: "Upload",
      language: "pt-BR",
      filename: row.file_name ?? "",
      fileSize: row.file_size ?? 1024,
      mimeType: row.mime_type ?? "application/pdf",
      totalPages: 1,
      processingStatus,
      createdAt: row.created_at ?? "",
      updatedAt: row.updated_at || row.created_at || "",

      // Dynamic RAG-specific database status & chunk fields
      status: row.status ?? "PENDENTE",
      totalChunks: row.total_chunks ?? 0,
      total_chunks: row.total_chunks ?? 0,
      totalEmbeddings: row.total_embeddings ?? 0,
      total_embeddings: row.total_embeddings ?? 0,
      extractedChars: row.extracted_chars ?? 0,
      extracted_chars: row.extracted_chars ?? 0,
      storagePath: row.storage_path ?? "",
      storage_path: row.storage_path ?? "",
    };
  }

  /**
   * List all documents sorted by creation date (descending)
   */
  async list(): Promise<Document[]> {
    const { data, error } = await this.supabase
      .from("knowledge_documents")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    return (data || []).map((row: any) => this.mapRowToDocument(row));
  }

  /**
   * Retrieve a document by its ID
   */
  async getById(id: string): Promise<Document | null> {
    const { data, error } = await this.supabase
      .from("knowledge_documents")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return null;
    }

    return this.mapRowToDocument(data);
  }

  /**
   * Create document metadata
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

    if (error) {
      throw error;
    }

    return this.mapRowToDocument(data);
  }

  /**
   * Update document metadata
   */
  async update(
    id: string,
    doc: Partial<Omit<Document, "id" | "createdAt" | "updatedAt" | "filename" | "fileSize" | "mimeType" | "totalPages">>
  ): Promise<Document | null> {
    const timestamp = new Date().toISOString();
    const { data, error } = await this.supabase
      .from("knowledge_documents")
      .update({
        updated_at: timestamp
      })
      .eq("id", id)
      .select()
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return null;
    }

    return this.mapRowToDocument(data);
  }

  /**
   * Delete a document by its ID
   * Returns true if document was deleted, false if not found
   */
  async delete(id: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from("knowledge_documents")
      .delete()
      .eq("id", id)
      .select();

    if (error) {
      throw error;
    }

    return !!(data && data.length > 0);
  }
}
