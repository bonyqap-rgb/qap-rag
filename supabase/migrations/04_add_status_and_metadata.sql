-- Migration: Add status and metadata columns to knowledge_documents for safe auditing
-- Using ADD COLUMN IF NOT EXISTS ensures Postgres safely skips columns if they already exist, preventing any database crash or duplicate errors.

ALTER TABLE public.knowledge_documents
  ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'PENDENTE',
  ADD COLUMN IF NOT EXISTS total_chunks INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_embeddings INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extracted_chars INTEGER DEFAULT 0;

-- Index the status column on knowledge_documents to speed up lookups
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_status ON public.knowledge_documents(status);

-- Comment to document
COMMENT ON COLUMN public.knowledge_documents.status IS 'The explicit processing state of the indexing pipeline (e.g., PENDENTE, PROCESSANDO, INDEXADO, INDEXAÇÃO_INVÁLIDA, etc.)';
