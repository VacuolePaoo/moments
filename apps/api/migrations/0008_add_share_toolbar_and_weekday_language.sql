ALTER TABLE settings ADD COLUMN share_toolbar_enabled INTEGER NOT NULL DEFAULT 1
  CHECK (share_toolbar_enabled IN (0, 1));

ALTER TABLE settings ADD COLUMN weekday_language TEXT NOT NULL DEFAULT 'zh'
  CHECK (weekday_language IN ('zh', 'en', 'ja'));

PRAGMA optimize;
