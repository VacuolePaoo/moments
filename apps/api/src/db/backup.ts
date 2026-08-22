import { ApiError } from "../lib/errors";
import type { CompleteBackup, RestoreBackupResult } from "../schemas";

interface IdRow {
  id: string;
}

interface ConflictCountRow {
  conflict_count: number;
}

const MAX_JSON_PARAMETER_BYTES = 1_500_000;
const textEncoder = new TextEncoder();

function jsonArrayPayloads<T>(
  values: readonly T[],
  serialize: (value: T) => string,
): string[] {
  const payloads: string[] = [];
  let entries: string[] = [];
  let byteLength = 2;

  for (const value of values) {
    const entry = serialize(value);
    const entryBytes = textEncoder.encode(entry).byteLength;
    const separatorBytes = entries.length === 0 ? 0 : 1;
    if (
      entries.length > 0 &&
      byteLength + separatorBytes + entryBytes > MAX_JSON_PARAMETER_BYTES
    ) {
      payloads.push(`[${entries.join(",")}]`);
      entries = [];
      byteLength = 2;
    }
    entries.push(entry);
    byteLength += (entries.length === 1 ? 0 : 1) + entryBytes;
  }

  if (entries.length > 0) payloads.push(`[${entries.join(",")}]`);
  return payloads.length === 0 ? ["[]"] : payloads;
}

function stringArrayPayloads(values: string[]): string[] {
  return jsonArrayPayloads(values, (value) => JSON.stringify(value));
}

function postImportPayloads(posts: CompleteBackup["posts"]): string[] {
  return jsonArrayPayloads(posts, (post) => {
    const entry = JSON.stringify({
      id: post.id,
      content: post.content,
      imagesJson: JSON.stringify(post.images),
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      deletedAt: post.deletedAt,
    });
    if (textEncoder.encode(entry).byteLength + 2 > MAX_JSON_PARAMETER_BYTES) {
      throw new ApiError(
        422,
        "BACKUP_POST_TOO_LARGE",
        "A backup post is too large to restore safely.",
      );
    }
    return entry;
  });
}

function conflictIdsStatements(
  db: D1Database,
  backup: CompleteBackup,
): D1PreparedStatement[] {
  return stringArrayPayloads(backup.posts.map((post) => post.id)).map((payload) =>
    db
      .prepare(
        `SELECT posts.id
         FROM posts
         INNER JOIN json_each(?) AS backup_ids
           ON posts.id = backup_ids.value
         ORDER BY posts.id`,
      )
      .bind(payload),
  );
}

function conflictCountStatements(
  db: D1Database,
  backup: CompleteBackup,
): D1PreparedStatement[] {
  return stringArrayPayloads(backup.posts.map((post) => post.id)).map((payload) =>
    db
      .prepare(
        `SELECT COUNT(*) AS conflict_count
         FROM posts
         INNER JOIN json_each(?) AS backup_ids
           ON posts.id = backup_ids.value`,
      )
      .bind(payload),
  );
}

export async function previewBackupRestore(
  db: D1Database,
  backup: CompleteBackup,
) {
  const results = await db.batch<IdRow>(conflictIdsStatements(db, backup));
  const conflicts = results
    .flatMap((result) => result.results)
    .sort((left, right) => left.id.localeCompare(right.id));
  return {
    totalPosts: backup.posts.length,
    conflictCount: conflicts.length,
    conflictIds: conflicts.map(({ id }) => id),
    settingsWillBeRestored: true as const,
  };
}

function importStatement(
  db: D1Database,
  payload: string,
  overwriteConflicts: boolean,
): D1PreparedStatement {
  const conflictClause = overwriteConflicts
    ? `ON CONFLICT(id) DO UPDATE SET
         content = excluded.content,
         images_json = excluded.images_json,
         created_at = excluded.created_at,
         updated_at = excluded.updated_at,
         deleted_at = excluded.deleted_at`
    : "";
  return db
    .prepare(
      `INSERT INTO posts (
         id, content, images_json, created_at, updated_at, deleted_at
       )
       SELECT
         json_extract(value, '$.id'),
         json_extract(value, '$.content'),
         json_extract(value, '$.imagesJson'),
         json_extract(value, '$.createdAt'),
       json_extract(value, '$.updatedAt'),
       json_extract(value, '$.deletedAt')
       FROM json_each(?)
       WHERE true
       ${conflictClause}`,
    )
    .bind(payload);
}

export async function restoreBackup(
  db: D1Database,
  backup: CompleteBackup,
  overwriteConflicts: boolean,
): Promise<RestoreBackupResult> {
  const now = new Date().toISOString();
  const conflictStatements = conflictCountStatements(db, backup);
  const statements: D1PreparedStatement[] = [
    ...conflictStatements,
    ...postImportPayloads(backup.posts).map((payload) =>
      importStatement(db, payload, overwriteConflicts),
    ),
    db
      .prepare(
        `UPDATE settings
         SET
           show_site_name = ?,
           site_name = ?,
           site_description = ?,
           statistics_enabled = ?,
           random_enabled = ?,
           rss_enabled = ?,
           content_public = ?,
           page_size = ?,
           updated_at = ?
         WHERE id = 1`,
      )
      .bind(
        Number(backup.settings.site.showName),
        backup.settings.site.name,
        backup.settings.site.description,
        Number(backup.settings.features.statistics),
        Number(backup.settings.features.random),
        Number(backup.settings.features.rss),
        Number(backup.settings.content.public),
        backup.settings.content.pageSize,
        backup.settings.updatedAt,
      ),
    db.prepare("DELETE FROM statistics_daily"),
    db.prepare("DELETE FROM statistics_hourly"),
    db.prepare("DELETE FROM public_post_slots"),
    db.prepare("DELETE FROM statistics_meta"),
    db.prepare(
      `INSERT INTO statistics_daily (
         date, post_count, character_count, longest_post_characters, image_count
       )
       SELECT
         date(created_at, '+8 hours'),
         COUNT(*),
         COALESCE(SUM(length(content)), 0),
         COALESCE(MAX(length(content)), 0),
         COALESCE(SUM(json_array_length(images_json)), 0)
       FROM posts
       WHERE deleted_at IS NULL
       GROUP BY date(created_at, '+8 hours')`,
    ),
    db.prepare(
      `INSERT INTO statistics_hourly (hour, post_count)
       SELECT
         CAST(strftime('%H', created_at, '+8 hours') AS INTEGER),
         COUNT(*)
       FROM posts
       WHERE deleted_at IS NULL
       GROUP BY strftime('%H', created_at, '+8 hours')`,
    ),
    db.prepare(
      `INSERT INTO public_post_slots (slot, post_id)
       SELECT ROW_NUMBER() OVER (ORDER BY id), id
       FROM posts
       WHERE deleted_at IS NULL
       ORDER BY id`,
    ),
    db
      .prepare("INSERT INTO statistics_meta (key, value) VALUES (?, ?)")
      .bind("rebuilt_at", now),
    db
      .prepare("INSERT INTO statistics_meta (key, value) VALUES (?, ?)")
      .bind("derived_data_version", "1"),
  ];

  try {
    const results = await db.batch<ConflictCountRow>(statements);
    let conflictCount = 0;
    for (const result of results.slice(0, conflictStatements.length)) {
      const count = result.results[0]?.conflict_count;
      if (typeof count !== "number") {
        throw new Error("D1 did not return the backup conflict count.");
      }
      conflictCount += count;
    }
    return {
      restoredPosts: backup.posts.length,
      insertedPosts: backup.posts.length - conflictCount,
      overwrittenPosts: conflictCount,
      settings: backup.settings,
    };
  } catch (error) {
    if (
      !overwriteConflicts &&
      /UNIQUE constraint failed:\s*posts\.id/iu.test(String(error))
    ) {
      throw new ApiError(
        409,
        "BACKUP_CONFLICT",
        "The backup conflicts with existing post IDs and overwrite was not confirmed.",
      );
    }
    throw error;
  }
}
