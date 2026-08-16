-- Enable vector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create documents table with proper constraints and defaults
CREATE TABLE IF NOT EXISTS public.documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    category VARCHAR(255) NOT NULL,
    version VARCHAR(50) NOT NULL,
    source VARCHAR(255) NOT NULL,
    language VARCHAR(50) NOT NULL,
    filename VARCHAR(255) NOT NULL,
    file_size BIGINT NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    total_pages INTEGER NOT NULL,
    processing_status VARCHAR(50) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,

    -- Constraints
    CONSTRAINT chk_processing_status CHECK (processing_status IN ('pending', 'processing', 'completed', 'failed')),
    CONSTRAINT chk_title_length CHECK (char_length(title) <= 255)
);

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_documents_processing_status ON public.documents(processing_status);
CREATE INDEX IF NOT EXISTS idx_documents_category ON public.documents(category);

-- Comment to document
COMMENT ON TABLE public.documents IS 'Table storing core metadata for documents in the QAP Document Management module.';

-- Create knowledge_documents table for RAG pipeline
CREATE TABLE IF NOT EXISTS public.knowledge_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_name VARCHAR(255) NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create indexing_history table
CREATE TABLE IF NOT EXISTS public.indexing_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document VARCHAR(255) NOT NULL,
    date TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    duration INTEGER NOT NULL,
    chunks_count INTEGER NOT NULL,
    embeddings_count INTEGER NOT NULL,
    success BOOLEAN NOT NULL,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_indexing_history_date ON public.indexing_history(date DESC);
COMMENT ON TABLE public.indexing_history IS 'Stores history of PDF parsing, chunking, and embedding generation runs.';

-- Create knowledge_chunks table with vector support
CREATE TABLE IF NOT EXISTS public.knowledge_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES public.knowledge_documents(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    embedding VECTOR(768) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Index for chunk retrieval
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_document_id ON public.knowledge_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_embedding ON public.knowledge_chunks USING hnsw (embedding vector_cosine_ops);

-- Enable RLS on storage.objects if not already enabled
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Drop policies if they already exist to avoid "already exists" migration errors
DROP POLICY IF EXISTS "Public Access" ON storage.objects;
DROP POLICY IF EXISTS "Public Upload" ON storage.objects;
DROP POLICY IF EXISTS "Public Delete" ON storage.objects;

-- Create storage bucket for 'documents' if it does not exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', true)
ON CONFLICT (id) DO NOTHING;

-- Re-create the storage policies for 'documents' bucket
CREATE POLICY "Public Access" ON storage.objects
    FOR SELECT TO public USING (bucket_id = 'documents');

CREATE POLICY "Public Upload" ON storage.objects
    FOR INSERT TO public WITH CHECK (bucket_id = 'documents');

CREATE POLICY "Public Delete" ON storage.objects
    FOR DELETE TO public USING (bucket_id = 'documents');
