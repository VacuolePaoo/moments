-- Incremental aggregates backing GET /api/v1/statistics.
-- Rebuilt from posts by POST /api/v1/statistics/rebuild (and lazily on first
-- read while statistics_meta is empty). Maintained incrementally by
-- create/update/soft-delete/restore so reads never scan the posts table.

CREATE TABLE statistics_daily (
  date TEXT PRIMARY KEY NOT NULL
    CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  post_count INTEGER NOT NULL CHECK (post_count >= 0),
  character_count INTEGER NOT NULL CHECK (character_count >= 0),
  longest_post_characters INTEGER NOT NULL CHECK (longest_post_characters >= 0),
  image_count INTEGER NOT NULL CHECK (image_count >= 0)
);

CREATE TABLE statistics_hourly (
  hour INTEGER PRIMARY KEY NOT NULL CHECK (hour BETWEEN 0 AND 23),
  post_count INTEGER NOT NULL CHECK (post_count >= 0)
);

CREATE TABLE statistics_meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
