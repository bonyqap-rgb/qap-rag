-- Migration: 10_atomic_update_chunks_rpc.sql
-- Goal: Redefine update_document_chunks_transaction to use robust standard float8[] array mapping for embeddings before casting to pgvector, ensuring 100% ACID database-level atomicity.

DROP FUNCTION IF EXISTS public.update_document_chunks_transaction(UUID, JSONB);

CREATE OR REPLACE FUNCTION public.update_document_chunks_transaction(p_k_doc_id UUID, p_chunks_data JSONB)
RETURNS VOID AS $$
DECLARE
    item RECORD;
BEGIN
    -- Delete old chunks
    DELETE FROM public.knowledge_chunks WHERE document_id = p_k_doc_id;

    -- Insert new chunks
    FOR item IN SELECT * FROM jsonb_to_recordset(p_chunks_data) AS x(chunk_index INT, content TEXT, embedding float8[])
    LOOP
        INSERT INTO public.knowledge_chunks (document_id, chunk_index, content, embedding)
        VALUES (p_k_doc_id, item.chunk_index, item.content, item.embedding::vector(1536));
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.update_document_chunks_transaction IS 'Updates all chunks for a document atomically inside a single ACID database transaction, preventing partial indexing states.';
