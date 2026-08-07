import { decodeCursor, encodeCursor } from "../lib/cursor";
import { ApiError } from "../lib/errors";
import type { Post, PostList } from "../schemas";

interface PostRow {
  id: string;
  content: string;
  images_json: string;
  created_at: string;
  updated_at: string;
}

interface IdRow {
  id: string;
}

function parseImages(value: string): string[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
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

const postColumns = "id, content, images_json, created_at, updated_at";

export async function listPosts(db: D1Database, limit: number, cursor?: string): Promise<PostList> {
  const pageSize = limit + 1;
  const statement = cursor === undefined
    ? db.prepare(
        `SELECT ${postColumns}
         FROM posts
         WHERE deleted_at IS NULL
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
      ).bind(pageSize)
    : (() => {
        const decoded = decodeCursor(cursor);
        return db.prepare(
          `SELECT ${postColumns}
           FROM posts
           WHERE deleted_at IS NULL
             AND (created_at < ? OR (created_at = ? AND id < ?))
           ORDER BY created_at DESC, id DESC
           LIMIT ?`,
        ).bind(decoded.createdAt, decoded.createdAt, decoded.id, pageSize);
      })();

  const result = await statement.all<PostRow>();
  const hasMore = result.results.length > limit;
  const visibleRows = hasMore ? result.results.slice(0, limit) : result.results;
  const last = visibleRows.at(-1);

  return {
    items: visibleRows.map(toPost),
    nextCursor: hasMore && last !== undefined
      ? encodeCursor({ createdAt: last.created_at, id: last.id })
      : null,
  };
}

export async function getPost(db: D1Database, id: string): Promise<Post> {
  const row = await db.prepare(
    `SELECT ${postColumns}
     FROM posts
     WHERE id = ? AND deleted_at IS NULL`,
  ).bind(id).first<PostRow>();

  if (row === null) {
    throw new ApiError(404, "POST_NOT_FOUND", "The post does not exist.");
  }
  return toPost(row);
}

export async function getPostNavigation(
  db: D1Database,
  post: Post,
): Promise<{ newerId: string | null; olderId: string | null }> {
  const results = await db.batch<IdRow>([
    db.prepare(
      `SELECT id
       FROM posts
       WHERE deleted_at IS NULL
         AND (created_at > ? OR (created_at = ? AND id > ?))
       ORDER BY created_at ASC, id ASC
       LIMIT 1`,
    ).bind(post.createdAt, post.createdAt, post.id),
    db.prepare(
      `SELECT id
       FROM posts
       WHERE deleted_at IS NULL
         AND (created_at < ? OR (created_at = ? AND id < ?))
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
    ).bind(post.createdAt, post.createdAt, post.id),
  ]);

  const newer = results[0];
  const older = results[1];
  if (newer === undefined || older === undefined) {
    throw new Error("D1 did not return both navigation query results.");
  }

  return {
    newerId: newer.results[0]?.id ?? null,
    olderId: older.results[0]?.id ?? null,
  };
}

export async function createPost(db: D1Database, content: string): Promise<Post> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.prepare(
    `INSERT INTO posts (id, content, images_json, created_at, updated_at)
     VALUES (?, ?, '[]', ?, ?)`,
  ).bind(id, content, now, now).run();

  return {
    id,
    content,
    images: [],
    createdAt: now,
    updatedAt: now,
    edited: false,
  };
}

export async function updatePost(db: D1Database, id: string, content: string): Promise<Post> {
  const updatedAt = new Date().toISOString();
  const result = await db.prepare(
    `UPDATE posts
     SET content = ?, updated_at = ?
     WHERE id = ? AND deleted_at IS NULL`,
  ).bind(content, updatedAt, id).run();

  if (result.meta.changes === 0) {
    throw new ApiError(404, "POST_NOT_FOUND", "The post does not exist.");
  }
  return getPost(db, id);
}

export async function softDeletePost(db: D1Database, id: string): Promise<void> {
  const result = await db.prepare(
    `UPDATE posts
     SET deleted_at = ?
     WHERE id = ? AND deleted_at IS NULL`,
  ).bind(new Date().toISOString(), id).run();

  if (result.meta.changes === 0) {
    throw new ApiError(404, "POST_NOT_FOUND", "The post does not exist.");
  }
}
