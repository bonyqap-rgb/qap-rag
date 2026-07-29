import { SupabaseClient } from "@supabase/supabase-js";
import { supabase as defaultSupabase } from "../config/supabase.js";
import { Document, DbDocument, mapDbToDocument, mapDocumentToDb } from "../models/document.model.js";

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
      .from("documents")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    return (data as DbDocument[] || []).map(mapDbToDocument);
  }

  /**
   * Retrieve a document by its ID
   */
  async getById(id: string): Promise<Document | null> {
    const { data, error } = await this.supabase
      .from("documents")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return null;
    }

    return mapDbToDocument(data as DbDocument);
  }

  /**
   * Create document metadata
   */
  async create(doc: Omit<Document, "id" | "createdAt" | "updatedAt"> & { id?: string }): Promise<Document> {
    const dbPayload = mapDocumentToDb(doc);

    const { data, error } = await this.supabase
      .from("documents")
      .insert(dbPayload)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return mapDbToDocument(data as DbDocument);
  }

  /**
   * Update document metadata
   */
  async update(
    id: string,
    doc: Partial<Omit<Document, "id" | "createdAt" | "updatedAt">>
  ): Promise<Document | null> {
    const dbPayload = mapDocumentToDb(doc);
    dbPayload.updated_at = new Date().toISOString();

    const { data, error } = await this.supabase
      .from("documents")
      .update(dbPayload)
      .eq("id", id)
      .select()
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return null;
    }

    return mapDbToDocument(data as DbDocument);
  }

  /**
   * Delete a document by its ID
   * Returns true if document was deleted, false if not found
   */
  async delete(id: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from("documents")
      .delete()
      .eq("id", id)
      .select();

    if (error) {
      throw error;
    }

    return !!(data && data.length > 0);
  }
}
