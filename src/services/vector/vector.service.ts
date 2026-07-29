import { SupabaseClient } from "@supabase/supabase-js";
import { supabase as defaultSupabase } from "../../config/supabase.js";

export interface DocumentChunk {
  id?: string;
  documentId: string;
  chunkIndex: number;
  texto: string;
  embedding: number[];
  createdAt?: string;
}

export class VectorService {
  private supabase: SupabaseClient;

  constructor(supabaseClient: SupabaseClient = defaultSupabase) {
    this.supabase = supabaseClient;
  }

  /**
   * Saves a single chunk and its embedding to the database.
   */
  async saveChunk(chunk: Omit<DocumentChunk, "id" | "createdAt">): Promise<DocumentChunk> {
    const { data, error } = await this.supabase
      .from("document_chunks")
      .insert({
        document_id: chunk.documentId,
        chunk_index: chunk.chunkIndex,
        texto: chunk.texto,
        embedding: chunk.embedding,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Erro ao salvar chunk no banco vetorial: ${error.message}`);
    }

    return {
      id: data.id,
      documentId: data.document_id,
      chunkIndex: data.chunk_index,
      texto: data.texto,
      embedding: data.embedding,
      createdAt: data.created_at,
    };
  }

  /**
   * Batch saves chunks and their embeddings to the database for optimal performance.
   */
  async saveChunks(chunks: Omit<DocumentChunk, "id" | "createdAt">[]): Promise<DocumentChunk[]> {
    if (chunks.length === 0) return [];

    const rows = chunks.map((c) => ({
      document_id: c.documentId,
      chunk_index: c.chunkIndex,
      texto: c.texto,
      embedding: c.embedding,
    }));

    const { data, error } = await this.supabase
      .from("document_chunks")
      .insert(rows)
      .select();

    if (error) {
      throw new Error(`Erro ao salvar lote de chunks no banco vetorial: ${error.message}`);
    }

    return (data || []).map((row: any) => ({
      id: row.id,
      documentId: row.document_id,
      chunkIndex: row.chunk_index,
      texto: row.texto,
      embedding: row.embedding,
      createdAt: row.created_at,
    }));
  }

  /**
   * Retrieves all chunks belonging to a document, ordered by chunk_index.
   */
  async getChunksByDocumentId(documentId: string): Promise<DocumentChunk[]> {
    const { data, error } = await this.supabase
      .from("document_chunks")
      .select("*")
      .eq("document_id", documentId)
      .order("chunk_index", { ascending: true });

    if (error) {
      throw new Error(`Erro ao obter chunks por document_id: ${error.message}`);
    }

    return (data || []).map((row: any) => ({
      id: row.id,
      documentId: row.document_id,
      chunkIndex: row.chunk_index,
      texto: row.texto,
      embedding: row.embedding,
      createdAt: row.created_at,
    }));
  }
}
