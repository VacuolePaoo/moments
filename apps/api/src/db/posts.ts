import { decodeCursor, encodeCursor } from "../lib/cursor";
import { getShanghaiDayBounds, toShanghaiDate } from "../lib/date";
import { ApiError } from "../lib/errors";
import type {
  DeletedPost,
  DeletedPostList,
  Post,
  PostDetail,
  PostList,
} from "../schemas";

export interface DateDetail {
  date: string;
  items: Post[];
  navigation: { newerDate: string | null; olderDate: string | null };
}

interface PostRow {
  id: string;
  content: string;
  images_json: string;
  created_at: string;
  updated_at: string;
}

interface DeletedPostRow extends PostRow {
  deleted_at: string;
}

interface IdRow {
  id: string;
}

interface CreatedAtRow {
  created_at: string;
}

interface DateDetailRow extends PostRow {
  newer_created_at: string | null;
  older_created_at: string | null;
}

interface RandomDateDetailRow extends DateDetailRow {
  selected_date: string;
}

interface PostDetailRow extends PostRow {
  newer_id: string | null;
  older_id: string | null;
}

interface DeletedPostImagesRow {
  images_json: string;
  deleted_at: string | null;
}

function parseImages(value: string): string[] {
  const parsed: unknown = JSON.parse(value);
  if (
    !Array.isArray(parsed) ||
    !parsed.every((item) => typeof item === "string")
  ) {
    throw new Error("Invalid images_json stored in D1.");
  }
  return parsed;
}

function toPost(row: PostRow): Post {
  return {
    id: row.id,
    content: row.content,
    images: parseImages(row.images_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    edited: row.updated_at !== row.created_at,
  };
}

function toDeletedPost(row: DeletedPostRow): DeletedPost {
  return { ...toPost(row), deletedAt: row.deleted_at };
}

const postColumns = "id, content, images_json, created_at, updated_at";
const qualifiedPostColumns =
  "p.id, p.content, p.images_json, p.created_at, p.updated_at";

function cursorPage<Row, Item>(
  rows: Row[],
  limit: number,
  toItem: (row: Row) => Item,
  cursorFromRow: (row: Row) => { createdAt: string; id: string },
): { items: Item[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  const visibleRows = hasMore ? rows.slice(0, limit) : rows;
  const last = visibleRows.at(-1);
  return {
    items: visibleRows.map(toItem),
    nextCursor:
      hasMore && last !== undefined ? encodeCursor(cursorFromRow(last)) : null,
  };
}

export async function listPosts(
  db: D1Database,
  limit: number,
  cursor?: string,
  anchorDate?: string,
): Promise<PostList> {
  const pageSize = limit + 1;
  const statement =
    cursor !== undefined
      ? (() => {
          const decoded = decodeCursor(cursor);
          return db
            .prepare(
              `SELECT ${postColumns}
           FROM posts
           WHERE deleted_at IS NULL
             AND (created_at, id) < (?, ?)
           ORDER BY created_at DESC, id DESC
           LIMIT ?`,
            )
            .bind(decoded.createdAt, decoded.id, pageSize);
        })()
      : anchorDate !== undefined
        ? db
            .prepare(
              `SELECT ${postColumns}
           FROM posts
           WHERE deleted_at IS NULL AND created_at < ?
           ORDER BY created_at DESC, id DESC
           LIMIT ?`,
            )
            .bind(getShanghaiDayBounds(anchorDate).endAt, pageSize)
        : db
            .prepare(
              `SELECT ${postColumns}
           FROM posts
           WHERE deleted_at IS NULL
           ORDER BY created_at DESC, id DESC
           LIMIT ?`,
            )
            .bind(pageSize);

  const { results } = await statement.all<PostRow>();
  return cursorPage(results, limit, toPost, (row) => ({
    createdAt: row.created_at,
    id: row.id,
  }));
}

export async function listDeletedPosts(
  db: D1Database,
  limit: number,
  cursor?: string,
): Promise<DeletedPostList> {
  const pageSize = limit + 1;
  const statement =
    cursor === undefined
      ? db
          .prepare(
            `SELECT ${postColumns}, deleted_at
             FROM posts
             WHERE deleted_at IS NOT NULL
             ORDER BY deleted_at DESC, id DESC
             LIMIT ?`,
          )
          .bind(pageSize)
      : (() => {
          const decoded = decodeCursor(cursor);
          return db
            .prepare(
              `SELECT ${postColumns}, deleted_at
               FROM posts
               WHERE deleted_at IS NOT NULL
                 AND (deleted_at, id) < (?, ?)
               ORDER BY deleted_at DESC, id DESC
               LIMIT ?`,
            )
            .bind(decoded.createdAt, decoded.id, pageSize);
        })();

  const { results } = await statement.all<DeletedPostRow>();
  return cursorPage(results, limit, toDeletedPost, (row) => ({
    createdAt: row.deleted_at,
    id: row.id,
  }));
}

export async function getDateDetail(
  db: D1Database,
  date: string,
): Promise<DateDetail> {
  const { startAt, endAt } = getShanghaiDayBounds(date);
  const { results } = await db
    .prepare(
      `WITH navigation AS MATERIALIZED (
         SELECT
           (SELECT created_at
            FROM posts
            WHERE deleted_at IS NULL AND created_at >= ?
            ORDER BY created_at ASC, id ASC
            LIMIT 1) AS newer_created_at,
           (SELECT created_at
            FROM posts
            WHERE deleted_at IS NULL AND created_at < ?
            ORDER BY created_at DESC, id DESC
            LIMIT 1) AS older_created_at
       )
       SELECT ${qualifiedPostColumns},
              navigation.newer_created_at,
              navigation.older_created_at
       FROM posts AS p
       CROSS JOIN navigation
       WHERE p.deleted_at IS NULL
         AND p.created_at >= ?
         AND p.created_at < ?
       ORDER BY p.created_at DESC, p.id DESC`,
    )
    .bind(endAt, startAt, startAt, endAt)
    .all<DateDetailRow>();

  const first = results[0];
  if (first === undefined) {
    throw new ApiError(
      404,
      "DATE_NOT_FOUND",
      "The requested date has no posts.",
    );
  }

  return {
    date,
    items: results.map(toPost),
    navigation: {
      newerDate:
        first.newer_created_at === null
          ? null
          : toShanghaiDate(first.newer_created_at),
      olderDate:
        first.older_created_at === null
          ? null
          : toShanghaiDate(first.older_created_at),
    },
  };
}

export async function getRandomDateDetail(db: D1Database): Promise<DateDetail> {
  let results: RandomDateDetailRow[];
  try {
    ({ results } = await db
      .prepare(
        `WITH selected AS MATERIALIZED (
         SELECT date(p.created_at, '+8 hours') AS selected_date,
                strftime(
                  '%Y-%m-%dT%H:%M:%fZ',
                  date(p.created_at, '+8 hours'),
                  '-8 hours'
                ) AS start_at,
                strftime(
                  '%Y-%m-%dT%H:%M:%fZ',
                  date(p.created_at, '+8 hours'),
                  '+1 day',
                  '-8 hours'
                ) AS end_at
         FROM public_post_slots AS slots
         JOIN posts AS p ON p.id = slots.post_id
         WHERE slots.slot = (
           SELECT 1 + (
             (random() & 9223372036854775807) % MAX(slot)
           )
           FROM public_post_slots
         )
       ),
       navigation AS MATERIALIZED (
         SELECT selected.*,
                (SELECT created_at
                 FROM posts
                 WHERE deleted_at IS NULL
                   AND created_at >= selected.end_at
                 ORDER BY created_at ASC, id ASC
                 LIMIT 1) AS newer_created_at,
                (SELECT created_at
                 FROM posts
                 WHERE deleted_at IS NULL
                   AND created_at < selected.start_at
                 ORDER BY created_at DESC, id DESC
                 LIMIT 1) AS older_created_at
         FROM selected
       )
       SELECT ${qualifiedPostColumns},
              navigation.selected_date,
              navigation.newer_created_at,
              navigation.older_created_at
       FROM navigation
       CROSS JOIN posts AS p INDEXED BY idx_posts_public_feed
       WHERE p.deleted_at IS NULL
         AND p.created_at >= navigation.start_at
         AND p.created_at < navigation.end_at
       ORDER BY p.created_at DESC, p.id DESC`,
      )
      .all<RandomDateDetailRow>());
  } catch (error) {
    if (!isMissingPublicPostSlotsError(error)) throw error;
    return getLegacyRandomDateDetail(db);
  }

  const first = results[0];
  if (first === undefined) {
    throw new ApiError(404, "POST_NOT_FOUND", "There are no posts to pick.");
  }
  return {
    date: first.selected_date,
    items: results.map(toPost),
    navigation: {
      newerDate:
        first.newer_created_at === null
          ? null
          : toShanghaiDate(first.newer_created_at),
      olderDate:
        first.older_created_at === null
          ? null
          : toShanghaiDate(first.older_created_at),
    },
  };
}

function isMissingPublicPostSlotsError(error: unknown): boolean {
  return /no such table:\s*(?:main\.)?public_post_slots/iu.test(String(error));
}

async function getLegacyRandomDateDetail(db: D1Database): Promise<DateDetail> {
  const selected = await db
    .prepare(
      `WITH public_posts AS (
         SELECT COUNT(*) AS count
         FROM posts
         WHERE deleted_at IS NULL
       )
       SELECT created_at
       FROM posts
       WHERE deleted_at IS NULL
       LIMIT 1 OFFSET COALESCE(
         (SELECT (random() & 9223372036854775807) % NULLIF(count, 0)
          FROM public_posts),
         0
       )`,
    )
    .first<CreatedAtRow>();

  if (selected === null) {
    throw new ApiError(404, "POST_NOT_FOUND", "There are no posts to pick.");
  }
  return getDateDetail(db, toShanghaiDate(selected.created_at));
}

export async function getPostDetail(
  db: D1Database,
  id: string,
): Promise<PostDetail> {
  const row = await db
    .prepare(
      `SELECT ${qualifiedPostColumns},
              (SELECT newer.id
               FROM posts AS newer
               WHERE newer.deleted_at IS NULL
                 AND (newer.created_at, newer.id) > (p.created_at, p.id)
               ORDER BY newer.created_at ASC, newer.id ASC
               LIMIT 1) AS newer_id,
              (SELECT older.id
               FROM posts AS older
               WHERE older.deleted_at IS NULL
                 AND (older.created_at, older.id) < (p.created_at, p.id)
               ORDER BY older.created_at DESC, older.id DESC
               LIMIT 1) AS older_id
       FROM posts AS p
       WHERE p.id = ? AND p.deleted_at IS NULL`,
    )
    .bind(id)
    .first<PostDetailRow>();

  if (row === null) {
    throw new ApiError(404, "POST_NOT_FOUND", "The post does not exist.");
  }
  return {
    post: toPost(row),
    navigation: { newerId: row.newer_id, olderId: row.older_id },
  };
}

export async function createPost(
  db: D1Database,
  content: string,
  images: string[],
): Promise<Post> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const imagesJson = JSON.stringify(images);

  await db
    .prepare(
      `INSERT INTO posts (id, content, images_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(id, content, imagesJson, now, now)
    .run();

  return {
    id,
    content,
    images,
    createdAt: now,
    updatedAt: now,
    edited: false,
  };
}

export async function updatePost(
  db: D1Database,
  id: string,
  content: string,
  images: string[],
): Promise<Post> {
  const updatedAt = new Date().toISOString();
  const imagesJson = JSON.stringify(images);
  const updated = await db
    .prepare(
      `UPDATE posts
       SET content = ?, images_json = ?, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL
       RETURNING ${postColumns}`,
    )
    .bind(content, imagesJson, updatedAt, id)
    .first<PostRow>();

  if (updated === null) {
    throw new ApiError(404, "POST_NOT_FOUND", "The post does not exist.");
  }
  return toPost(updated);
}

export async function softDeletePost(
  db: D1Database,
  id: string,
): Promise<void> {
  const deleted = await db
    .prepare(
      `UPDATE posts
       SET deleted_at = ?
       WHERE id = ? AND deleted_at IS NULL
       RETURNING id`,
    )
    .bind(new Date().toISOString(), id)
    .first<IdRow>();

  if (deleted === null) {
    throw new ApiError(404, "POST_NOT_FOUND", "The post does not exist.");
  }
}

export async function restorePost(db: D1Database, id: string): Promise<Post> {
  const restored = await db
    .prepare(
      `UPDATE posts
       SET deleted_at = NULL
       WHERE id = ? AND deleted_at IS NOT NULL
       RETURNING ${postColumns}`,
    )
    .bind(id)
    .first<PostRow>();

  if (restored === null) {
    return throwPostStateError(db, id);
  }
  return toPost(restored);
}

export async function getDeletedPostImages(
  db: D1Database,
  id: string,
): Promise<string[]> {
  const row = await db
    .prepare(
      `SELECT images_json, deleted_at
       FROM posts
       WHERE id = ?`,
    )
    .bind(id)
    .first<DeletedPostImagesRow>();

  if (row === null) {
    throw new ApiError(404, "POST_NOT_FOUND", "The post does not exist.");
  }
  if (row.deleted_at === null) {
    throw new ApiError(409, "POST_NOT_DELETED", "The post is not deleted.");
  }
  return parseImages(row.images_json);
}

export async function permanentlyDeletePost(
  db: D1Database,
  id: string,
): Promise<void> {
  const deleted = await db
    .prepare(
      "DELETE FROM posts WHERE id = ? AND deleted_at IS NOT NULL RETURNING id",
    )
    .bind(id)
    .first<IdRow>();

  if (deleted !== null) return;
  return throwPostStateError(db, id);
}

async function throwPostStateError(db: D1Database, id: string): Promise<never> {
  const existing = await db
    .prepare("SELECT deleted_at FROM posts WHERE id = ?")
    .bind(id)
    .first<{ deleted_at: string | null }>();
  if (existing === null) {
    throw new ApiError(404, "POST_NOT_FOUND", "The post does not exist.");
  }
  throw new ApiError(409, "POST_NOT_DELETED", "The post is not deleted.");
}
