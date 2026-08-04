-- Migration: Upgrade Vector Dimensions to 1536 and regenerate embeddings
-- This migration updates the database column size and RPC function to strictly use 1536-dimensional vectors.

-- 1. Ensure pgvector extension is enabled
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Drop existing match_documents function(s) to prevent any dimension signature conflicts
DROP FUNCTION IF EXISTS public.match_documents(vector, integer);
DROP FUNCTION IF EXISTS public.match_documents(vector(3072), integer);
DROP FUNCTION IF EXISTS public.match_documents(vector(1536), integer);

-- 3. Nullify existing embeddings to avoid 'different vector dimensions' constraints when altering column type,
-- but PRESERVE the raw text contents of chunks so we can easily regenerate them in place.
UPDATE public.knowledge_chunks SET embedding = NULL;

-- 4. Alter the embedding column dimension in knowledge_chunks to exactly 1536
ALTER TABLE public.knowledge_chunks
  ALTER COLUMN embedding TYPE vector(1536);

-- 5. Drop any existing index and recreate optimized HNSW index for vector(1536)
DROP INDEX IF EXISTS idx_knowledge_chunks_embedding;
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_embedding
  ON public.knowledge_chunks USING hnsw (embedding vector_cosine_ops);

-- 6. Recreate the match_documents RPC to strictly enforce and perform 1536x1536 comparisons
-- Supports optional document filters to guarantee filtering is performed BEFORE ORDER BY and LIMIT in the SQL engine
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
  WHERE kc.embedding IS NOT NULL  -- Only compare with non-null embeddings during transition/indexing
    AND (filter_document_id IS NULL OR kc.document_id = filter_document_id)
    AND (filter_document_ids IS NULL OR kc.document_id = ANY(filter_document_ids))
  ORDER BY kc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- 7. Create the match_knowledge_chunks RPC as a synchronized alias for match_documents
-- Supports optional document filters to guarantee filtering is performed BEFORE ORDER BY and LIMIT in the SQL engine
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
