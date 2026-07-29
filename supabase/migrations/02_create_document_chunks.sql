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

-- PL/pgSQL function to save document chunks transactionally and with idempotency
CREATE OR REPLACE FUNCTION public.save_document_chunks_json(
    p_document_id UUID,
    p_chunks JSONB
) RETURNS VOID AS $$
DECLARE
    chunk_row RECORD;
BEGIN
    -- Delete old vectors for the same document to ensure idempotency and clear old state
    DELETE FROM public.document_chunks WHERE document_id = p_document_id;

    -- Iterate and insert each chunk inside the database transaction
    FOR chunk_row IN
        SELECT (value->>'chunk_index')::INTEGER AS chunk_index,
               (value->>'texto')::TEXT AS texto,
               (value->>'embedding')::TEXT AS embedding_str
        FROM jsonb_array_elements(p_chunks)
    LOOP
        INSERT INTO public.document_chunks (document_id, chunk_index, texto, embedding)
        VALUES (
            p_document_id,
            chunk_row.chunk_index,
            chunk_row.texto,
            chunk_row.embedding_str::vector
        );
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Comment to document
COMMENT ON TABLE public.document_chunks IS 'Table storing semantic chunks and vector embeddings for document pages.';
