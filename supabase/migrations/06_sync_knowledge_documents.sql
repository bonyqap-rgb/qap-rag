-- Migration: Synchronize public.knowledge_documents table structure, indices, constraints, and defaults.
-- This migration ensures the table is fully compatible with the backend expected schema.

-- 1. Create table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.knowledge_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_name VARCHAR(255) NOT NULL UNIQUE,
    status VARCHAR(50) DEFAULT 'PENDENTE' NOT NULL,
    total_chunks INTEGER DEFAULT 0 NOT NULL,
    total_embeddings INTEGER DEFAULT 0 NOT NULL,
    extracted_chars INTEGER DEFAULT 0 NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT chk_knowledge_documents_status CHECK (status IN ('PENDENTE', 'PROCESSANDO', 'INDEXADO', 'INDEXAÇÃO_INVÁLIDA'))
);

-- 2. Safely add missing columns if the table already existed
ALTER TABLE public.knowledge_documents
  ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS file_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'PENDENTE',
  ADD COLUMN IF NOT EXISTS total_chunks INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_embeddings INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extracted_chars INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now());

-- 3. Standardize column data types, default values, and non-nullability constraints
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

-- 4. Ensure Primary Key constraint on ID exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE table_name = 'knowledge_documents'
          AND constraint_type = 'PRIMARY KEY'
    ) THEN
        ALTER TABLE public.knowledge_documents ADD PRIMARY KEY (id);
    END IF;
END $$;

-- 5. Ensure Unique constraint on file_name exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE table_name = 'knowledge_documents'
          AND constraint_type = 'UNIQUE'
          AND constraint_name = 'knowledge_documents_file_name_key'
    ) THEN
        -- Safely remove any legacy duplicates before applying the unique constraint
        DELETE FROM public.knowledge_documents a
        USING public.knowledge_documents b
        WHERE a.id < b.id AND a.file_name = b.file_name;

        ALTER TABLE public.knowledge_documents ADD CONSTRAINT knowledge_documents_file_name_key UNIQUE (file_name);
    END IF;
END $$;

-- 6. Re-apply CHECK constraint for status values
ALTER TABLE public.knowledge_documents DROP CONSTRAINT IF EXISTS chk_knowledge_documents_status;
ALTER TABLE public.knowledge_documents ADD CONSTRAINT chk_knowledge_documents_status
  CHECK (status IN ('PENDENTE', 'PROCESSANDO', 'INDEXADO', 'INDEXAÇÃO_INVÁLIDA'));

-- 7. Ensure optimized indexes are present
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_status
  ON public.knowledge_documents(status);

CREATE INDEX IF NOT EXISTS idx_knowledge_documents_file_name
  ON public.knowledge_documents(file_name);

CREATE INDEX IF NOT EXISTS idx_knowledge_documents_created_at
  ON public.knowledge_documents(created_at DESC);

-- 8. Add clear documentation comments to the table and columns
COMMENT ON TABLE public.knowledge_documents IS 'Table storing core metadata and processing status of indexed documents in the RAG pipeline.';
COMMENT ON COLUMN public.knowledge_documents.id IS 'Primary key UUID of the knowledge document.';
COMMENT ON COLUMN public.knowledge_documents.file_name IS 'Original filename of the uploaded PDF document.';
COMMENT ON COLUMN public.knowledge_documents.status IS 'The explicit processing state of the indexing pipeline (e.g., PENDENTE, PROCESSANDO, INDEXADO, INDEXAÇÃO_INVÁLIDA).';
COMMENT ON COLUMN public.knowledge_documents.total_chunks IS 'Total number of parsed text chunks extracted from this document.';
COMMENT ON COLUMN public.knowledge_documents.total_embeddings IS 'Total number of generated vector embeddings persisted for this document.';
COMMENT ON COLUMN public.knowledge_documents.extracted_chars IS 'Total count of characters extracted during the PDF parsing phase.';
COMMENT ON COLUMN public.knowledge_documents.created_at IS 'Timestamp of document metadata creation.';
COMMENT ON COLUMN public.knowledge_documents.updated_at IS 'Timestamp of last document status or metadata update.';
