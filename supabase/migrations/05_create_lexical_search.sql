-- Migration: Add Portuguese Lexical Search RPC
-- This migration defines a PostgreSQL RPC function to search for chunks using PostgreSQL Full Text Search (FTS).

-- 1. Create an optimized GIN index for full-text search on chunk content in Portuguese
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_content_fts
  ON public.knowledge_chunks USING gin (to_tsvector('portuguese', content));

-- 2. Create the match_knowledge_chunks_lexical RPC function
CREATE OR REPLACE FUNCTION public.match_knowledge_chunks_lexical (
  query_text text,
  match_count int
)
RETURNS TABLE (
  id uuid,
  document_id uuid,
  chunk_index int,
  content text,
  similarity double precision
)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    kc.id,
    kc.document_id,
    kc.chunk_index,
    kc.content,
    ts_rank_cd(to_tsvector('portuguese', kc.content), websearch_to_tsquery('portuguese', query_text))::double precision AS similarity
  FROM public.knowledge_chunks kc
  WHERE to_tsvector('portuguese', kc.content) @@ websearch_to_tsquery('portuguese', query_text)
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;

-- 3. Comment to document
COMMENT ON FUNCTION public.match_knowledge_chunks_lexical IS 'Performs a PostgreSQL lexical full-text search on knowledge chunks in Portuguese and ranks by cover density similarity.';
