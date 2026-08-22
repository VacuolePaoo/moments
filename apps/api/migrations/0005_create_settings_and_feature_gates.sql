CREATE TABLE settings (
  id INTEGER PRIMARY KEY NOT NULL DEFAULT 1 CHECK (id = 1),
  show_site_name INTEGER NOT NULL DEFAULT 1
    CHECK (show_site_name IN (0, 1)),
  site_name TEXT NOT NULL DEFAULT 'Moments'
    CHECK (length(site_name) BETWEEN 1 AND 80),
  site_description TEXT NOT NULL DEFAULT ''
    CHECK (length(site_description) <= 280),
  statistics_enabled INTEGER NOT NULL DEFAULT 1
    CHECK (statistics_enabled IN (0, 1)),
  random_enabled INTEGER NOT NULL DEFAULT 1
    CHECK (random_enabled IN (0, 1)),
  rss_enabled INTEGER NOT NULL DEFAULT 1
    CHECK (rss_enabled IN (0, 1)),
  content_public INTEGER NOT NULL DEFAULT 1
    CHECK (content_public IN (0, 1)),
  page_size INTEGER NOT NULL DEFAULT 20
    CHECK (page_size BETWEEN 1 AND 100),
  updated_at TEXT NOT NULL
);

INSERT INTO settings (id, updated_at)
VALUES (1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- Migration 0004 combined statistics and random-slot maintenance in several
-- triggers. Split them so statistics can be paused without breaking random
-- selection slots.
DROP TRIGGER posts_derived_after_insert;
DROP TRIGGER posts_statistics_after_content_update;
DROP TRIGGER posts_derived_after_soft_delete;
DROP TRIGGER posts_derived_after_restore;
DROP TRIGGER posts_slots_before_public_delete;
DROP TRIGGER posts_statistics_after_public_delete;

CREATE TRIGGER posts_slots_after_insert
AFTER INSERT ON posts
WHEN NEW.deleted_at IS NULL
BEGIN
  INSERT INTO public_post_slots (slot, post_id)
  SELECT COALESCE(MAX(slot), 0) + 1, NEW.id
  FROM public_post_slots;
END;

CREATE TRIGGER posts_slots_after_soft_delete
AFTER UPDATE OF deleted_at ON posts
WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL
BEGIN
  INSERT OR REPLACE INTO public_post_slots (slot, post_id)
  SELECT
    (SELECT slot FROM public_post_slots WHERE post_id = OLD.id),
    post_id
  FROM public_post_slots
  ORDER BY slot DESC
  LIMIT 1;

  DELETE FROM public_post_slots WHERE post_id = OLD.id;
END;

CREATE TRIGGER posts_slots_after_restore
AFTER UPDATE OF deleted_at ON posts
WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL
BEGIN
  INSERT INTO public_post_slots (slot, post_id)
  SELECT COALESCE(MAX(slot), 0) + 1, NEW.id
  FROM public_post_slots;
END;

CREATE TRIGGER posts_slots_before_public_delete
BEFORE DELETE ON posts
WHEN OLD.deleted_at IS NULL
BEGIN
  INSERT OR REPLACE INTO public_post_slots (slot, post_id)
  SELECT
    (SELECT slot FROM public_post_slots WHERE post_id = OLD.id),
    post_id
  FROM public_post_slots
  ORDER BY slot DESC
  LIMIT 1;

  DELETE FROM public_post_slots WHERE post_id = OLD.id;
END;

CREATE TRIGGER posts_statistics_after_insert
AFTER INSERT ON posts
WHEN NEW.deleted_at IS NULL
  AND (SELECT statistics_enabled FROM settings WHERE id = 1) = 1
BEGIN
  INSERT INTO statistics_daily (
    date,
    post_count,
    character_count,
    longest_post_characters,
    image_count
  )
  VALUES (
    date(NEW.created_at, '+8 hours'),
    1,
    length(NEW.content),
    length(NEW.content),
    json_array_length(NEW.images_json)
  )
  ON CONFLICT(date) DO UPDATE SET
    post_count = post_count + 1,
    character_count = character_count + excluded.character_count,
    longest_post_characters =
      MAX(longest_post_characters, excluded.longest_post_characters),
    image_count = image_count + excluded.image_count;

  INSERT INTO statistics_hourly (hour, post_count)
  VALUES (
    CAST(strftime('%H', NEW.created_at, '+8 hours') AS INTEGER),
    1
  )
  ON CONFLICT(hour) DO UPDATE SET post_count = post_count + 1;
END;

CREATE TRIGGER posts_statistics_after_content_update
AFTER UPDATE OF content, images_json ON posts
WHEN OLD.deleted_at IS NULL
  AND NEW.deleted_at IS NULL
  AND (SELECT statistics_enabled FROM settings WHERE id = 1) = 1
  AND (
    OLD.content <> NEW.content
    OR OLD.images_json <> NEW.images_json
  )
BEGIN
  UPDATE statistics_daily
  SET
    character_count =
      MAX(character_count + length(NEW.content) - length(OLD.content), 0),
    image_count = MAX(
      image_count
        + json_array_length(NEW.images_json)
        - json_array_length(OLD.images_json),
      0
    ),
    longest_post_characters = CASE
      WHEN length(NEW.content) >= longest_post_characters
        THEN length(NEW.content)
      WHEN length(OLD.content) >= longest_post_characters
        THEN (
          SELECT COALESCE(MAX(length(content)), 0)
          FROM posts
          WHERE deleted_at IS NULL
            AND created_at >= strftime(
              '%Y-%m-%dT%H:%M:%fZ',
              date(NEW.created_at, '+8 hours'),
              '-8 hours'
            )
            AND created_at < strftime(
              '%Y-%m-%dT%H:%M:%fZ',
              date(NEW.created_at, '+8 hours'),
              '+1 day',
              '-8 hours'
            )
        )
      ELSE longest_post_characters
    END
  WHERE date = date(NEW.created_at, '+8 hours');
END;

CREATE TRIGGER posts_statistics_after_soft_delete
AFTER UPDATE OF deleted_at ON posts
WHEN OLD.deleted_at IS NULL
  AND NEW.deleted_at IS NOT NULL
  AND (SELECT statistics_enabled FROM settings WHERE id = 1) = 1
BEGIN
  UPDATE statistics_daily
  SET
    post_count = MAX(post_count - 1, 0),
    character_count = MAX(character_count - length(OLD.content), 0),
    image_count =
      MAX(image_count - json_array_length(OLD.images_json), 0),
    longest_post_characters = CASE
      WHEN length(OLD.content) >= longest_post_characters
        THEN (
          SELECT COALESCE(MAX(length(content)), 0)
          FROM posts
          WHERE deleted_at IS NULL
            AND created_at >= strftime(
              '%Y-%m-%dT%H:%M:%fZ',
              date(OLD.created_at, '+8 hours'),
              '-8 hours'
            )
            AND created_at < strftime(
              '%Y-%m-%dT%H:%M:%fZ',
              date(OLD.created_at, '+8 hours'),
              '+1 day',
              '-8 hours'
            )
        )
      ELSE longest_post_characters
    END
  WHERE date = date(OLD.created_at, '+8 hours');

  DELETE FROM statistics_daily
  WHERE date = date(OLD.created_at, '+8 hours') AND post_count = 0;

  UPDATE statistics_hourly
  SET post_count = MAX(post_count - 1, 0)
  WHERE hour = CAST(strftime('%H', OLD.created_at, '+8 hours') AS INTEGER);

  DELETE FROM statistics_hourly
  WHERE hour = CAST(strftime('%H', OLD.created_at, '+8 hours') AS INTEGER)
    AND post_count = 0;
END;

CREATE TRIGGER posts_statistics_after_restore
AFTER UPDATE OF deleted_at ON posts
WHEN OLD.deleted_at IS NOT NULL
  AND NEW.deleted_at IS NULL
  AND (SELECT statistics_enabled FROM settings WHERE id = 1) = 1
BEGIN
  INSERT INTO statistics_daily (
    date,
    post_count,
    character_count,
    longest_post_characters,
    image_count
  )
  VALUES (
    date(NEW.created_at, '+8 hours'),
    1,
    length(NEW.content),
    length(NEW.content),
    json_array_length(NEW.images_json)
  )
  ON CONFLICT(date) DO UPDATE SET
    post_count = post_count + 1,
    character_count = character_count + excluded.character_count,
    longest_post_characters =
      MAX(longest_post_characters, excluded.longest_post_characters),
    image_count = image_count + excluded.image_count;

  INSERT INTO statistics_hourly (hour, post_count)
  VALUES (
    CAST(strftime('%H', NEW.created_at, '+8 hours') AS INTEGER),
    1
  )
  ON CONFLICT(hour) DO UPDATE SET post_count = post_count + 1;
END;

CREATE TRIGGER posts_statistics_after_public_delete
AFTER DELETE ON posts
WHEN OLD.deleted_at IS NULL
  AND (SELECT statistics_enabled FROM settings WHERE id = 1) = 1
BEGIN
  UPDATE statistics_daily
  SET
    post_count = MAX(post_count - 1, 0),
    character_count = MAX(character_count - length(OLD.content), 0),
    image_count =
      MAX(image_count - json_array_length(OLD.images_json), 0),
    longest_post_characters = CASE
      WHEN length(OLD.content) >= longest_post_characters
        THEN (
          SELECT COALESCE(MAX(length(content)), 0)
          FROM posts
          WHERE deleted_at IS NULL
            AND created_at >= strftime(
              '%Y-%m-%dT%H:%M:%fZ',
              date(OLD.created_at, '+8 hours'),
              '-8 hours'
            )
            AND created_at < strftime(
              '%Y-%m-%dT%H:%M:%fZ',
              date(OLD.created_at, '+8 hours'),
              '+1 day',
              '-8 hours'
            )
        )
      ELSE longest_post_characters
    END
  WHERE date = date(OLD.created_at, '+8 hours');

  DELETE FROM statistics_daily
  WHERE date = date(OLD.created_at, '+8 hours') AND post_count = 0;

  UPDATE statistics_hourly
  SET post_count = MAX(post_count - 1, 0)
  WHERE hour = CAST(strftime('%H', OLD.created_at, '+8 hours') AS INTEGER);

  DELETE FROM statistics_hourly
  WHERE hour = CAST(strftime('%H', OLD.created_at, '+8 hours') AS INTEGER)
    AND post_count = 0;
END;

PRAGMA optimize;
