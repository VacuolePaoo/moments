ALTER TABLE settings ADD COLUMN voice_enabled INTEGER NOT NULL DEFAULT 1
  CHECK (voice_enabled IN (0, 1));

PRAGMA optimize;
