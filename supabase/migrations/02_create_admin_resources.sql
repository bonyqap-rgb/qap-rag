-- Admin Resources Migration
-- Defines tables and RPCs for administration, stats, metrics, safe deletion, and reindexing.

-- 1. Indexing History Table
CREATE TABLE IF NOT EXISTS public.indexing_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document VARCHAR(255) NOT NULL,
    date TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    duration INTEGER NOT NULL, -- Duration in milliseconds
    chunks_count INTEGER NOT NULL,
    embeddings_count INTEGER NOT NULL,
    success BOOLEAN NOT NULL,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Index for querying indexing history quickly
CREATE INDEX IF NOT EXISTS idx_indexing_history_date ON public.indexing_history(date DESC);

-- Comment to document
COMMENT ON TABLE public.indexing_history IS 'Stores history of PDF parsing, chunking, and embedding generation runs.';

-- 2. Safe Deletion Transaction Function
CREATE OR REPLACE FUNCTION public.delete_document_transaction(doc_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_filename VARCHAR;
    v_k_doc_id UUID;
    v_deleted BOOLEAN := FALSE;
BEGIN
    -- Get filename from documents
    SELECT filename INTO v_filename FROM public.documents WHERE id = doc_id;

    IF v_filename IS NOT NULL THEN
        -- Find knowledge document id
        SELECT id INTO v_k_doc_id FROM public.knowledge_documents WHERE file_name = v_filename;

        IF v_k_doc_id IS NOT NULL THEN
            -- Delete chunks (this also deletes embeddings as they are stored inside chunks)
            DELETE FROM public.knowledge_chunks WHERE document_id = v_k_doc_id;

            -- Delete from knowledge_documents
            DELETE FROM public.knowledge_documents WHERE id = v_k_doc_id;
        END IF;

        -- Delete from documents
        DELETE FROM public.documents WHERE id = doc_id;
        v_deleted := TRUE;
    END IF;

    RETURN v_deleted;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Knowledge Base Statistics Function
CREATE OR REPLACE FUNCTION public.get_knowledge_base_stats()
RETURNS JSON AS $$
DECLARE
    v_total_docs BIGINT;
    v_indexed_docs BIGINT;
    v_pending_docs BIGINT;
    v_total_chunks BIGINT;
    v_avg_chunks_per_doc NUMERIC;
    v_avg_chunk_size NUMERIC;
    v_last_indexed TIMESTAMP WITH TIME ZONE;
    v_total_vectors BIGINT;
    v_total_k_docs BIGINT;
BEGIN
    -- Total documents in metadata table
    SELECT COUNT(*) INTO v_total_docs FROM public.documents;

    -- Indexed documents (completed status)
    SELECT COUNT(*) INTO v_indexed_docs FROM public.documents WHERE processing_status = 'completed';

    -- Pending documents (pending status)
    SELECT COUNT(*) INTO v_pending_docs FROM public.documents WHERE processing_status = 'pending';

    -- Total chunks in knowledge_chunks
    SELECT COUNT(*) INTO v_total_chunks FROM public.knowledge_chunks;

    -- Total knowledge documents
    SELECT COUNT(*) INTO v_total_k_docs FROM public.knowledge_documents;

    -- Average chunks per document
    IF v_total_k_docs > 0 THEN
        v_avg_chunks_per_doc := ROUND(v_total_chunks::numeric / v_total_k_docs::numeric, 2);
    ELSE
        v_avg_chunks_per_doc := 0;
    END IF;

    -- Average chunk size (character length of content)
    SELECT COALESCE(AVG(char_length(content)), 0) INTO v_avg_chunk_size FROM public.knowledge_chunks;
    v_avg_chunk_size := ROUND(v_avg_chunk_size, 2);

    -- Date of last indexing
    SELECT MAX(created_at) INTO v_last_indexed FROM public.knowledge_documents;

    -- Total vectors stored. In pgvector, each row in knowledge_chunks has one vector in the embedding column.
    SELECT COUNT(*) INTO v_total_vectors FROM public.knowledge_chunks WHERE embedding IS NOT NULL;

    RETURN json_build_object(
        'total_documentos', v_total_docs,
        'documentos_indexados', v_indexed_docs,
        'documentos_pendentes', v_pending_docs,
        'total_chunks', v_total_chunks,
        'media_chunks_por_documento', v_avg_chunks_per_doc,
        'tamanho_medio_chunks', v_avg_chunk_size,
        'data_ultima_indexacao', v_last_indexed,
        'quantidade_vetores_armazenados', v_total_vectors
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Reindexing Chunk Update Transaction Function
CREATE OR REPLACE FUNCTION public.update_document_chunks_transaction(p_k_doc_id UUID, p_chunks_data JSONB)
RETURNS VOID AS $$
DECLARE
    item RECORD;
BEGIN
    -- Delete old chunks
    DELETE FROM public.knowledge_chunks WHERE document_id = p_k_doc_id;

    -- Insert new chunks
    FOR item IN SELECT * FROM jsonb_to_recordset(p_chunks_data) AS x(chunk_index INT, content TEXT, embedding VECTOR)
    LOOP
        INSERT INTO public.knowledge_chunks (document_id, chunk_index, content, embedding)
        VALUES (p_k_doc_id, item.chunk_index, item.content, item.embedding);
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
