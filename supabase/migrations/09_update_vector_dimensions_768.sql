-- Migration: 09_update_vector_dimensions_768.sql
-- Goal: Upgrade pgvector column and match functions to strictly use 768-dimensional vectors (Gemini text-embedding-004).

CREATE EXTENSION IF NOT EXISTS vector;

-- 1. Drop 1536-dim RPC functions to avoid signature conflicts
DROP FUNCTION IF EXISTS public.match_documents(vector, integer);
DROP FUNCTION IF EXISTS public.match_documents(vector(1536), integer);
DROP FUNCTION IF EXISTS public.match_documents(vector(1536), integer, uuid, uuid[]);
DROP FUNCTION IF EXISTS public.match_knowledge_chunks(vector, integer);
DROP FUNCTION IF EXISTS public.match_knowledge_chunks(vector(1536), integer);
DROP FUNCTION IF EXISTS public.match_knowledge_chunks(vector(1536), integer, uuid, uuid[]);

-- 2. Alter column type to vector(768)
ALTER TABLE public.knowledge_chunks
  ALTER COLUMN embedding TYPE vector(768);

-- 3. Recreate HNSW index for vector(768)
DROP INDEX IF EXISTS idx_knowledge_chunks_embedding;
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_embedding
  ON public.knowledge_chunks USING hnsw (embedding vector_cosine_ops);

-- 4. Recreate match_documents RPC for vector(768)
CREATE OR REPLACE FUNCTION public.match_documents (
  query_embedding vector(768),
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

-- 5. Recreate match_knowledge_chunks RPC for vector(768)
CREATE OR REPLACE FUNCTION public.match_knowledge_chunks (
  query_embedding vector(768),
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
