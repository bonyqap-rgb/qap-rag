import { SupabaseClient } from "@supabase/supabase-js";
import { supabase as defaultSupabase } from "../config/supabase.js";
import { Document, mapDbToDocument } from "../models/document.model.js";

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

    return (data || []).map((row: any) => mapDbToDocument(row));
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

    return mapDbToDocument(data);
  }

  /**
   * Create document metadata
   */
  async create(doc: Omit<Document, "id" | "createdAt" | "updatedAt"> & { id?: string }): Promise<Document> {
    const { data, error } = await this.supabase
      .from("knowledge_documents")
      .insert({
        id: doc.id,
        file_name: doc.filename || doc.title,
        status: doc.status || "PENDENTE",
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return mapDbToDocument(data);
  }

  /**
   * Update document metadata
   */
  async update(
    id: string,
    doc: Partial<Omit<Document, "id" | "createdAt" | "updatedAt" | "filename" | "fileSize" | "mimeType" | "totalPages">>
  ): Promise<Document | null> {
    const timestamp = new Date().toISOString();
    const updatePayload: any = { updated_at: timestamp };
    if (doc.status) updatePayload.status = doc.status;

    const { data, error } = await this.supabase
      .from("knowledge_documents")
      .update(updatePayload)
      .eq("id", id)
      .select()
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return null;
    }

    return mapDbToDocument(data);
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
