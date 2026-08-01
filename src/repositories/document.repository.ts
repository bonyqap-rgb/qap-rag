import { SupabaseClient } from "@supabase/supabase-js";
import { supabase as defaultSupabase } from "../config/supabase.js";
import { Document } from "../models/document.model.js";

export class DocumentRepository {
  private supabase: SupabaseClient;

  constructor(supabaseClient: SupabaseClient = defaultSupabase) {
    this.supabase = supabaseClient;
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

    return (data || []).map((row: any) => ({
      id: row.id ?? "",
      title: row.file_name ?? "",
      category: "Geral",
      version: "1.0",
      source: "Upload",
      language: "pt-BR",
      filename: row.file_name ?? "",
      fileSize: 1024,
      mimeType: "application/pdf",
      totalPages: 1,
      processingStatus: "completed",
      createdAt: row.created_at ?? "",
      updatedAt: row.updated_at || row.created_at || "",
    }));
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

    return {
      id: data.id ?? "",
      title: data.file_name ?? "",
      category: "Geral",
      version: "1.0",
      source: "Upload",
      language: "pt-BR",
      filename: data.file_name ?? "",
      fileSize: 1024,
      mimeType: "application/pdf",
      totalPages: 1,
      processingStatus: "completed",
      createdAt: data.created_at ?? "",
      updatedAt: data.updated_at || data.created_at || "",
    };
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

    return {
      id: data.id ?? "",
      title: data.file_name ?? "",
      category: "Geral",
      version: "1.0",
      source: "Upload",
      language: "pt-BR",
      filename: data.file_name ?? "",
      fileSize: 1024,
      mimeType: "application/pdf",
      totalPages: 1,
      processingStatus: "completed",
      createdAt: data.created_at ?? "",
      updatedAt: data.updated_at || data.created_at || "",
    };
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

    return {
      id: data.id ?? "",
      title: data.file_name ?? "",
      category: "Geral",
      version: "1.0",
      source: "Upload",
      language: "pt-BR",
      filename: data.file_name ?? "",
      fileSize: 1024,
      mimeType: "application/pdf",
      totalPages: 1,
      processingStatus: "completed",
      createdAt: data.created_at ?? "",
      updatedAt: data.updated_at || data.created_at || "",
    };
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
