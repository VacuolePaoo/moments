ALTER TABLE posts ADD COLUMN kind TEXT NOT NULL DEFAULT 'article'
  CHECK (kind IN ('article', 'audio'));

ALTER TABLE posts ADD COLUMN audio_url TEXT;
ALTER TABLE posts ADD COLUMN audio_duration_ms INTEGER
  CHECK (audio_duration_ms IS NULL OR audio_duration_ms BETWEEN 1 AND 1800000);
ALTER TABLE posts ADD COLUMN audio_mime_type TEXT;
ALTER TABLE posts ADD COLUMN audio_size_bytes INTEGER
  CHECK (audio_size_bytes IS NULL OR audio_size_bytes BETWEEN 1 AND 33554432);

CREATE TRIGGER posts_validate_kind_before_insert
BEFORE INSERT ON posts
-- A NULL audio column makes the whole condition evaluate to NULL, and a NULL
-- WHEN clause never fires the trigger. COALESCE treats "unknown" as invalid.
WHEN NOT COALESCE(
  (
    NEW.kind = 'article'
    AND NEW.audio_url IS NULL
    AND NEW.audio_duration_ms IS NULL
    AND NEW.audio_mime_type IS NULL
    AND NEW.audio_size_bytes IS NULL
  )
  OR
  (
    NEW.kind = 'audio'
    AND NEW.content = ''
    AND length(NEW.audio_url) BETWEEN 1 AND 2048
    AND NEW.audio_duration_ms BETWEEN 1 AND 1800000
    AND NEW.audio_mime_type LIKE 'audio/%'
    AND length(NEW.audio_mime_type) <= 100
    AND NEW.audio_size_bytes BETWEEN 1 AND 33554432
  ),
  0
)
BEGIN
  SELECT RAISE(ABORT, 'invalid post kind payload');
END;

CREATE TRIGGER posts_validate_kind_before_update
BEFORE UPDATE OF kind, content, images_json, audio_url, audio_duration_ms,
  audio_mime_type, audio_size_bytes ON posts
-- A NULL audio column makes the whole condition evaluate to NULL, and a NULL
-- WHEN clause never fires the trigger. COALESCE treats "unknown" as invalid.
WHEN NOT COALESCE(
  (
    NEW.kind = 'article'
    AND NEW.audio_url IS NULL
    AND NEW.audio_duration_ms IS NULL
    AND NEW.audio_mime_type IS NULL
    AND NEW.audio_size_bytes IS NULL
  )
  OR
  (
    NEW.kind = 'audio'
    AND NEW.content = ''
    AND length(NEW.audio_url) BETWEEN 1 AND 2048
    AND NEW.audio_duration_ms BETWEEN 1 AND 1800000
    AND NEW.audio_mime_type LIKE 'audio/%'
    AND length(NEW.audio_mime_type) <= 100
    AND NEW.audio_size_bytes BETWEEN 1 AND 33554432
  ),
  0
)
BEGIN
  SELECT RAISE(ABORT, 'invalid post kind payload');
END;

PRAGMA optimize;
