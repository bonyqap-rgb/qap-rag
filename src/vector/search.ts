import { supabase } from "../config/supabase.js";

export async function searchKnowledge(
  embedding: number[],
  limit = 5
) {
  const { data, error } = await supabase.rpc("match_documents", {
    query_embedding: embedding,
    match_count: limit,
  });

  if (error) {
    throw error;
  }

  return data;
}