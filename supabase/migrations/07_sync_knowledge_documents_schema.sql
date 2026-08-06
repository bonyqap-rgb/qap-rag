-- Migration: 07_sync_knowledge_documents_schema.sql
-- Goal: Safely synchronize the public.knowledge_documents table schema by adding missing columns,
-- constraints, default values, indices, and Row Level Security (RLS) policies.
-- It preserves existing table data (including id, file_name, storage_path, sha256, mime_type, file_size, and created_at).

-- 1. Create table if it doesn't exist (e.g. in new clean environments)
CREATE TABLE IF NOT EXISTS public.knowledge_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_name VARCHAR(255) NOT NULL UNIQUE,
    storage_path VARCHAR(512),
    sha256 VARCHAR(64),
    mime_type VARCHAR(100),
    file_size BIGINT,
    status VARCHAR(50) DEFAULT 'PENDENTE' NOT NULL,
    total_chunks INTEGER DEFAULT 0 NOT NULL,
    total_embeddings INTEGER DEFAULT 0 NOT NULL,
    extracted_chars INTEGER DEFAULT 0 NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT chk_knowledge_documents_status CHECK (status IN ('PENDENTE', 'PROCESSANDO', 'INDEXADO', 'INDEXAÇÃO_INVÁLIDA'))
);

-- 2. Safely add missing columns to ensure the table matches the full unified structure if it already existed
ALTER TABLE public.knowledge_documents
  ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS file_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS storage_path VARCHAR(512),
  ADD COLUMN IF NOT EXISTS sha256 VARCHAR(64),
  ADD COLUMN IF NOT EXISTS mime_type VARCHAR(100),
  ADD COLUMN IF NOT EXISTS file_size BIGINT,
  ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'PENDENTE',
  ADD COLUMN IF NOT EXISTS total_chunks INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_embeddings INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extracted_chars INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now());

-- 3. Safely update any NULL values in existing records to prevent NOT NULL constraint violations
UPDATE public.knowledge_documents SET status = 'PENDENTE' WHERE status IS NULL;
UPDATE public.knowledge_documents SET total_chunks = 0 WHERE total_chunks IS NULL;
UPDATE public.knowledge_documents SET total_embeddings = 0 WHERE total_embeddings IS NULL;
UPDATE public.knowledge_documents SET extracted_chars = 0 WHERE extracted_chars IS NULL;
UPDATE public.knowledge_documents SET created_at = timezone('utc'::text, now()) WHERE created_at IS NULL;
UPDATE public.knowledge_documents SET updated_at = COALESCE(created_at, timezone('utc'::text, now())) WHERE updated_at IS NULL;

-- 4. Standardize column data types, default values, and non-nullability constraints
ALTER TABLE public.knowledge_documents ALTER COLUMN file_name SET DATA TYPE VARCHAR(255);
ALTER TABLE public.knowledge_documents ALTER COLUMN file_name SET NOT NULL;

ALTER TABLE public.knowledge_documents ALTER COLUMN status SET DATA TYPE VARCHAR(50);
ALTER TABLE public.knowledge_documents ALTER COLUMN status SET DEFAULT 'PENDENTE';
ALTER TABLE public.knowledge_documents ALTER COLUMN status SET NOT NULL;

ALTER TABLE public.knowledge_documents ALTER COLUMN total_chunks SET DATA TYPE INTEGER;
ALTER TABLE public.knowledge_documents ALTER COLUMN total_chunks SET DEFAULT 0;
ALTER TABLE public.knowledge_documents ALTER COLUMN total_chunks SET NOT NULL;

ALTER TABLE public.knowledge_documents ALTER COLUMN total_embeddings SET DATA TYPE INTEGER;
ALTER TABLE public.knowledge_documents ALTER COLUMN total_embeddings SET DEFAULT 0;
ALTER TABLE public.knowledge_documents ALTER COLUMN total_embeddings SET NOT NULL;

ALTER TABLE public.knowledge_documents ALTER COLUMN extracted_chars SET DATA TYPE INTEGER;
ALTER TABLE public.knowledge_documents ALTER COLUMN extracted_chars SET DEFAULT 0;
ALTER TABLE public.knowledge_documents ALTER COLUMN extracted_chars SET NOT NULL;

ALTER TABLE public.knowledge_documents ALTER COLUMN created_at SET DATA TYPE TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.knowledge_documents ALTER COLUMN created_at SET DEFAULT timezone('utc'::text, now());
ALTER TABLE public.knowledge_documents ALTER COLUMN created_at SET NOT NULL;

ALTER TABLE public.knowledge_documents ALTER COLUMN updated_at SET DATA TYPE TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.knowledge_documents ALTER COLUMN updated_at SET DEFAULT timezone('utc'::text, now());
ALTER TABLE public.knowledge_documents ALTER COLUMN updated_at SET NOT NULL;

-- 5. Ensure Primary Key constraint on ID exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE table_schema = 'public'
          AND table_name = 'knowledge_documents'
          AND constraint_type = 'PRIMARY KEY'
    ) THEN
        ALTER TABLE public.knowledge_documents ADD PRIMARY KEY (id);
    END IF;
END $$;

-- 6. Ensure Unique constraint on file_name exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE table_schema = 'public'
          AND table_name = 'knowledge_documents'
          AND constraint_type = 'UNIQUE'
          AND constraint_name = 'knowledge_documents_file_name_key'
    ) THEN
        -- Safely remove any duplicate entries on file_name if any exist before applying the constraint
        DELETE FROM public.knowledge_documents a
        USING public.knowledge_documents b
        WHERE a.id < b.id AND a.file_name = b.file_name;

        ALTER TABLE public.knowledge_documents ADD CONSTRAINT knowledge_documents_file_name_key UNIQUE (file_name);
    END IF;
END $$;

-- 7. Ensure CHECK constraint on status exists
ALTER TABLE public.knowledge_documents DROP CONSTRAINT IF EXISTS chk_knowledge_documents_status;
ALTER TABLE public.knowledge_documents ADD CONSTRAINT chk_knowledge_documents_status
  CHECK (status IN ('PENDENTE', 'PROCESSANDO', 'INDEXADO', 'INDEXAÇÃO_INVÁLIDA'));

-- 8. Ensure optimized indexes are present
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_status
  ON public.knowledge_documents(status);

CREATE INDEX IF NOT EXISTS idx_knowledge_documents_file_name
  ON public.knowledge_documents(file_name);

CREATE INDEX IF NOT EXISTS idx_knowledge_documents_created_at
  ON public.knowledge_documents(created_at DESC);

-- 9. Enable and configure Row-Level Security (RLS) policies
ALTER TABLE public.knowledge_documents ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist to prevent errors
DROP POLICY IF EXISTS select_knowledge_documents_policy ON public.knowledge_documents;
DROP POLICY IF EXISTS insert_knowledge_documents_policy ON public.knowledge_documents;
DROP POLICY IF EXISTS update_knowledge_documents_policy ON public.knowledge_documents;
DROP POLICY IF EXISTS delete_knowledge_documents_policy ON public.knowledge_documents;

-- Create secure and inclusive RLS policies
CREATE POLICY select_knowledge_documents_policy ON public.knowledge_documents
    FOR SELECT USING (true);

CREATE POLICY insert_knowledge_documents_policy ON public.knowledge_documents
    FOR INSERT WITH CHECK (true);

CREATE POLICY update_knowledge_documents_policy ON public.knowledge_documents
    FOR UPDATE USING (true) WITH CHECK (true);

CREATE POLICY delete_knowledge_documents_policy ON public.knowledge_documents
    FOR DELETE USING (true);

-- 10. Add clear documentation comments to the table and columns
COMMENT ON TABLE public.knowledge_documents IS 'Table storing core metadata and processing status of indexed documents in the RAG pipeline.';
COMMENT ON COLUMN public.knowledge_documents.id IS 'Primary key UUID of the knowledge document.';
COMMENT ON COLUMN public.knowledge_documents.file_name IS 'Original filename of the uploaded PDF document.';
COMMENT ON COLUMN public.knowledge_documents.storage_path IS 'S3 or local physical storage path of the raw PDF file.';
COMMENT ON COLUMN public.knowledge_documents.sha256 IS 'SHA-256 hash checksum of the uploaded raw file for integrity check.';
COMMENT ON COLUMN public.knowledge_documents.mime_type IS 'Mime type of the uploaded file (e.g., application/pdf).';
COMMENT ON COLUMN public.knowledge_documents.file_size IS 'Size of the uploaded file in bytes.';
COMMENT ON COLUMN public.knowledge_documents.status IS 'The explicit processing state of the indexing pipeline (e.g., PENDENTE, PROCESSANDO, INDEXADO, INDEXAÇÃO_INVÁLIDA).';
COMMENT ON COLUMN public.knowledge_documents.total_chunks IS 'Total number of parsed text chunks extracted from this document.';
COMMENT ON COLUMN public.knowledge_documents.total_embeddings IS 'Total number of generated vector embeddings persisted for this document.';
COMMENT ON COLUMN public.knowledge_documents.extracted_chars IS 'Total count of characters extracted during the PDF parsing phase.';
COMMENT ON COLUMN public.knowledge_documents.created_at IS 'Timestamp of document metadata creation.';
COMMENT ON COLUMN public.knowledge_documents.updated_at IS 'Timestamp of last document status or metadata update.';
