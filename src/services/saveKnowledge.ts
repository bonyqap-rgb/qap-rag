import { supabase } from "../config/supabase.js";

export async function saveKnowledge(
  fileName: string,
  chunks: string[],
  embeddings: number[][]
) {
  const { data: document, error: documentError } = await supabase
    .from("knowledge_documents")
    .insert({
      file_name: fileName,
    })
    .select()
    .single();

  if (documentError) throw documentError;

  const rows = chunks.map((chunk, index) => ({
    document_id: document.id,
    chunk_index: index,
    content: chunk,
    embedding: embeddings[index],
  }));

  const { error } = await supabase
    .from("knowledge_chunks")
    .insert(rows);

  if (error) throw error;

  return document.id;
}