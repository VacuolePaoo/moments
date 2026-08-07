CREATE TABLE posts (
  id TEXT PRIMARY KEY NOT NULL,
  content TEXT NOT NULL CHECK (length(trim(content)) > 0),
  images_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(images_json) AND json_type(images_json) = 'array'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX idx_posts_public_feed
  ON posts (created_at DESC, id DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_posts_deleted_at
  ON posts (deleted_at DESC)
  WHERE deleted_at IS NOT NULL;

