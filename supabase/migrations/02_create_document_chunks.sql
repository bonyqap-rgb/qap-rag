-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Alter documents table to include extracted_text column if it doesn't exist
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS extracted_text TEXT;

-- Alter the check constraint on processing_status to allow 'indexed'
-- Drop existing constraint first
ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS chk_processing_status;

-- Add updated constraint with 'indexed' included
ALTER TABLE public.documents ADD CONSTRAINT chk_processing_status CHECK (processing_status IN ('pending', 'processing', 'completed', 'failed', 'indexed'));

-- Create document_chunks table
CREATE TABLE IF NOT EXISTS public.document_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    texto TEXT NOT NULL,
    embedding VECTOR(768) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Index for document_id
CREATE INDEX IF NOT EXISTS idx_document_chunks_document_id ON public.document_chunks(document_id);

-- Vector index for similarity search (HNSW index with Cosine Distance)
CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding ON public.document_chunks USING hnsw (embedding vector_cosine_ops);

-- Comment to document
COMMENT ON TABLE public.document_chunks IS 'Table storing semantic chunks and vector embeddings for document pages.';
