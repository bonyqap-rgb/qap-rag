-- Migration: 10_atomic_update_chunks_rpc.sql
-- Goal: Create a PostgreSQL database function to atomically replace document chunks within a single ACID transaction.
-- If any insert fails, the entire transaction rolls back, preserving the original valid chunks untouched.

CREATE OR REPLACE FUNCTION public.update_document_chunks_transaction(
    p_document_id UUID,
    p_chunks JSONB
) RETURNS VOID AS $$
DECLARE
    v_chunk JSONB;
    v_embedding_array DOUBLE PRECISION[];
    v_embedding vector;
BEGIN
    -- 1. Atomic deletion of previous chunks associated with this document
    DELETE FROM public.knowledge_chunks
    WHERE document_id = p_document_id;

    -- 2. Loop through each chunk element and insert atomically
    FOR v_chunk IN SELECT * FROM jsonb_array_elements(p_chunks) LOOP
        -- Parse the embedded float array from JSON to DOUBLE PRECISION[]
        SELECT ARRAY(
            SELECT jsonb_array_elements_text(v_chunk->'embedding')::DOUBLE PRECISION
        ) INTO v_embedding_array;

        -- Safe conversion to pgvector
        v_embedding := v_embedding_array::vector;

        -- Perform secure insert
        INSERT INTO public.knowledge_chunks (
            document_id,
            chunk_index,
            content,
            embedding
        ) VALUES (
            p_document_id,
            (v_chunk->>'chunk_index')::INTEGER,
            v_chunk->>'content',
            v_embedding
        );
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Document function
COMMENT ON FUNCTION public.update_document_chunks_transaction IS 'Atomically deletes old chunks and inserts new chunks for a document inside a single transaction to prevent inconsistent states.';
