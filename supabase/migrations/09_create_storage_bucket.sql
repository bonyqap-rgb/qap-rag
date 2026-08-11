-- Migration: 09_create_storage_bucket.sql
-- Goal: Safely create the 'documents' Supabase Storage bucket and configure public access policies.

-- 1. Insert the 'documents' bucket if it doesn't already exist
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('documents', 'documents', true, 52428800, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE
SET public = true,
    file_size_limit = 52428800,
    allowed_mime_types = ARRAY['application/pdf'];

-- 2. Enable Row-Level Security on storage.objects
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- 3. Create RLS policies for the 'documents' bucket to allow public select, insert, update, and delete
DROP POLICY IF EXISTS "Public Access - Select" ON storage.objects;
CREATE POLICY "Public Access - Select" ON storage.objects
    FOR SELECT USING (bucket_id = 'documents');

DROP POLICY IF EXISTS "Public Access - Insert" ON storage.objects;
CREATE POLICY "Public Access - Insert" ON storage.objects
    FOR INSERT WITH CHECK (bucket_id = 'documents');

DROP POLICY IF EXISTS "Public Access - Update" ON storage.objects;
CREATE POLICY "Public Access - Update" ON storage.objects
    FOR UPDATE USING (bucket_id = 'documents') WITH CHECK (bucket_id = 'documents');

DROP POLICY IF EXISTS "Public Access - Delete" ON storage.objects;
CREATE POLICY "Public Access - Delete" ON storage.objects
    FOR DELETE USING (bucket_id = 'documents');
