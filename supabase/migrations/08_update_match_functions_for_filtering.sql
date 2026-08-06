-- Migration: 08_update_match_functions_for_filtering.sql
-- Goal: Redefine RPC functions to support pre-limit filtering by document_id and document_ids, preventing silent result drops or PostgREST truncation issues.

-- 1. Redefine public.match_documents
CREATE OR REPLACE FUNCTION public.match_documents (
  query_embedding vector(1536),
  match_count int,
  filter_document_id uuid DEFAULT NULL,
  filter_document_ids uuid[] DEFAULT NULL
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
    1 - (kc.embedding <=> query_embedding) AS similarity
  FROM public.knowledge_chunks kc
  WHERE kc.embedding IS NOT NULL
    AND (filter_document_id IS NULL OR kc.document_id = filter_document_id)
    AND (filter_document_ids IS NULL OR kc.document_id = ANY(filter_document_ids))
  ORDER BY kc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- 2. Redefine public.match_knowledge_chunks
CREATE OR REPLACE FUNCTION public.match_knowledge_chunks (
  query_embedding vector(1536),
  match_count int,
  filter_document_id uuid DEFAULT NULL,
  filter_document_ids uuid[] DEFAULT NULL
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
    1 - (kc.embedding <=> query_embedding) AS similarity
  FROM public.knowledge_chunks kc
  WHERE kc.embedding IS NOT NULL
    AND (filter_document_id IS NULL OR kc.document_id = filter_document_id)
    AND (filter_document_ids IS NULL OR kc.document_id = ANY(filter_document_ids))
  ORDER BY kc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- 3. Redefine public.match_knowledge_chunks_lexical
CREATE OR REPLACE FUNCTION public.match_knowledge_chunks_lexical (
  query_text text,
  match_count int,
  filter_document_id uuid DEFAULT NULL,
  filter_document_ids uuid[] DEFAULT NULL
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
    AND (filter_document_id IS NULL OR kc.document_id = filter_document_id)
    AND (filter_document_ids IS NULL OR kc.document_id = ANY(filter_document_ids))
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;
