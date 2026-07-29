import crypto from "crypto";
import { supabase } from "../config/supabase.js";
import { logger } from "./logger.service.js";

export interface IndexingHistoryEntry {
  id?: string;
  document: string;
  date: string;
  duration: number; // in milliseconds
  chunks_count: number;
  embeddings_count: number;
  success: boolean;
  error_message?: string;
}

class IndexingHistoryService {
  private memoryHistory: IndexingHistoryEntry[] = [];

  /**
   * Records a new indexing operation history entry.
   * Attempts to insert into the database first, falling back to local memory if needed.
   */
  async record(entry: IndexingHistoryEntry): Promise<void> {
    const recordWithId: IndexingHistoryEntry = {
      id: crypto.randomUUID(),
      ...entry,
    };

    // Store in-memory as backup / fallback
    this.memoryHistory.push(recordWithId);

    try {
      const { error } = await supabase
        .from("indexing_history")
        .insert({
          document: entry.document,
          date: entry.date,
          duration: entry.duration,
          chunks_count: entry.chunks_count,
          embeddings_count: entry.embeddings_count,
          success: entry.success,
          error_message: entry.error_message || null,
        });

      if (error) {
        logger.warn(`[HISTORY] Falha ao inserir histórico no banco: ${error.message}. Mantido em memória.`);
      }
    } catch (err: any) {
      logger.warn(`[HISTORY] Erro ao salvar histórico de indexação no banco: ${err.message || err}. Mantido em memória.`);
    }
  }

  /**
   * Retrieves all recorded indexing history.
   * Queries the database, falling back to memory if database query fails.
   */
  async getHistory(): Promise<IndexingHistoryEntry[]> {
    try {
      const { data, error } = await supabase
        .from("indexing_history")
        .select("*")
        .order("date", { ascending: false });

      if (error) {
        logger.warn(`[HISTORY] Falha ao consultar histórico no banco: ${error.message}. Retornando do cache em memória.`);
        return this.getMemoryHistory();
      }

      return (data || []).map((row: any) => ({
        id: row.id,
        document: row.document,
        date: row.date,
        duration: row.duration,
        chunks_count: row.chunks_count,
        embeddings_count: row.embeddings_count,
        success: row.success,
        error_message: row.error_message || undefined,
      }));
    } catch (err: any) {
      logger.warn(`[HISTORY] Erro ao carregar histórico de indexação do banco: ${err.message || err}. Retornando do cache em memória.`);
      return this.getMemoryHistory();
    }
  }

  private getMemoryHistory(): IndexingHistoryEntry[] {
    return [...this.memoryHistory].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );
  }

  /**
   * Clears memory cache for clean testing environment.
   */
  public clear(): void {
    this.memoryHistory = [];
  }
}

export const indexingHistoryService = new IndexingHistoryService();
