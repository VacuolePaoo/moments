-- Keep statistics aggregates and the dense public-post sampling slots in sync
-- inside the same SQLite statement that mutates posts. This removes the
-- application-side read-before-write calls while preserving atomicity.

CREATE TABLE public_post_slots (
  slot INTEGER PRIMARY KEY NOT NULL CHECK (slot > 0),
  post_id TEXT NOT NULL UNIQUE
    REFERENCES posts (id) ON DELETE CASCADE
);

-- Backfill every derived table before enabling incremental maintenance. This
-- also repairs deployments where v2 writes occurred before the first rebuild.
DELETE FROM statistics_daily;
DELETE FROM statistics_hourly;
DELETE FROM statistics_meta;

INSERT INTO statistics_daily (
  date,
  post_count,
  character_count,
  longest_post_characters,
  image_count
)
SELECT
  date(created_at, '+8 hours'),
  COUNT(*),
  COALESCE(SUM(length(content)), 0),
  COALESCE(MAX(length(content)), 0),
  COALESCE(SUM(json_array_length(images_json)), 0)
FROM posts
WHERE deleted_at IS NULL
GROUP BY date(created_at, '+8 hours');

INSERT INTO statistics_hourly (hour, post_count)
SELECT
  CAST(strftime('%H', created_at, '+8 hours') AS INTEGER),
  COUNT(*)
FROM posts
WHERE deleted_at IS NULL
GROUP BY strftime('%H', created_at, '+8 hours');

INSERT INTO statistics_meta (key, value)
VALUES
  ('rebuilt_at', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('derived_data_version', '1');

INSERT INTO public_post_slots (slot, post_id)
SELECT ROW_NUMBER() OVER (ORDER BY id), id
FROM posts
WHERE deleted_at IS NULL
ORDER BY id;

CREATE TRIGGER posts_derived_after_insert
AFTER INSERT ON posts
WHEN NEW.deleted_at IS NULL
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

  INSERT INTO public_post_slots (slot, post_id)
  SELECT COALESCE(MAX(slot), 0) + 1, NEW.id
  FROM public_post_slots;
END;

CREATE TRIGGER posts_statistics_after_content_update
AFTER UPDATE OF content, images_json ON posts
WHEN OLD.deleted_at IS NULL
  AND NEW.deleted_at IS NULL
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

CREATE TRIGGER posts_derived_after_soft_delete
AFTER UPDATE OF deleted_at ON posts
WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL
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

  -- Move the last slot into the removed slot. INSERT OR REPLACE resolves both
  -- the slot and post_id uniqueness conflicts, keeping slots dense in O(1).
  INSERT OR REPLACE INTO public_post_slots (slot, post_id)
  SELECT
    (SELECT slot FROM public_post_slots WHERE post_id = OLD.id),
    post_id
  FROM public_post_slots
  ORDER BY slot DESC
  LIMIT 1;

  DELETE FROM public_post_slots WHERE post_id = OLD.id;
END;

CREATE TRIGGER posts_derived_after_restore
AFTER UPDATE OF deleted_at ON posts
WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL
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

  INSERT INTO public_post_slots (slot, post_id)
  SELECT COALESCE(MAX(slot), 0) + 1, NEW.id
  FROM public_post_slots;
END;

-- Direct hard deletes of public rows are not used by the API, but keeping the
-- triggers complete prevents manual SQL maintenance from corrupting snapshots.
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

CREATE TRIGGER posts_statistics_after_public_delete
AFTER DELETE ON posts
WHEN OLD.deleted_at IS NULL
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
