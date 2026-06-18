-- ============================================================
-- Trace & Hunter — recovery-photos storage bucket
-- Created: 2026-06-18
-- Hunter PWA uploads Mark Found / In Transit proof photos here.
-- Public-read (HO dashboard + getPublicUrl), authenticated-write.
-- ============================================================

-- ── Bucket ───────────────────────────────────────────────────
-- public = true so getPublicUrl() links resolve without signing.
INSERT INTO storage.buckets (id, name, public)
VALUES ('recovery-photos', 'recovery-photos', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

-- ── Policies on storage.objects (scoped to this bucket) ──────
-- Public read (bucket is public, but explicit policy keeps RLS happy).
DROP POLICY IF EXISTS "recovery_photos_public_read" ON storage.objects;
CREATE POLICY "recovery_photos_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'recovery-photos');

-- Authenticated upload only (hunters signed in via magic link).
DROP POLICY IF EXISTS "recovery_photos_auth_insert" ON storage.objects;
CREATE POLICY "recovery_photos_auth_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'recovery-photos' AND auth.role() = 'authenticated');
