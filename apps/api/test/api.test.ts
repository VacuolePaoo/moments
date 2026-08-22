import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { ApiError } from "../src/lib/errors";
import type { TokenVerifier } from "../src/types";

const adminVerifier: TokenVerifier = () =>
  Promise.resolve({ userId: env.ADMIN_CLERK_USER_ID });
const nonAdminVerifier: TokenVerifier = () =>
  Promise.resolve({ userId: "user_not_admin" });

async function clearPosts() {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM posts"),
    env.DB.prepare("DELETE FROM statistics_daily"),
    env.DB.prepare("DELETE FROM statistics_hourly"),
    env.DB.prepare("DELETE FROM statistics_meta"),
    env.DB.prepare("DELETE FROM public_post_slots"),
    env.DB.prepare(
      `UPDATE settings
       SET
         show_site_name = 1,
         site_name = 'Moments',
         site_description = '',
         statistics_enabled = 1,
         random_enabled = 1,
         rss_enabled = 1,
         content_public = 1,
         page_size = 20,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = 1`,
    ),
  ]);
}

function jsonRequest(method: string, body?: unknown, token = "test-token") {
  return {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Origin: env.ALLOWED_ORIGIN,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

describe("Moments API", () => {
  beforeEach(clearPosts);

  it("reports Worker and D1 health", async () => {
    const response = await createApp().request("/health", {}, env);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      database: "ok",
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("publishes an OpenAPI 3.1 contract", async () => {
    const response = await createApp().request("/openapi.json", {}, env);
    const document = await response.json<{
      openapi: string;
      paths: Record<string, unknown>;
    }>();
    expect(document.openapi).toBe("3.1.0");
    expect(document.paths).toHaveProperty("/api/v1/posts");
    expect(document.paths).toHaveProperty("/api/v1/posts/{id}");
    expect(document.paths).toHaveProperty("/api/v1/posts/{id}/images");
    expect(document.paths).toHaveProperty("/api/v1/posts/{id}/restore");
    expect(document.paths).not.toHaveProperty("/api/v1/dates/{date}");
    expect(document.paths).toHaveProperty("/api/v1/statistics");
    expect(document.paths).toHaveProperty("/api/v1/statistics/rebuild");
    expect(document.paths).toHaveProperty("/api/v1/random");
    expect(document.paths).toHaveProperty("/api/v1/trash");
    expect(document.paths).toHaveProperty("/api/v1/trash/{id}");
    expect(document.paths).toHaveProperty("/rss.xml");
    expect(document.paths).toHaveProperty("/api/v1/settings/public");
    expect(document.paths).toHaveProperty("/api/v1/settings");
    expect(document.paths).toHaveProperty("/api/v1/maintenance/backup");
    expect(document.paths).toHaveProperty(
      "/api/v1/maintenance/restore/preview",
    );
    expect(document.paths).toHaveProperty("/api/v1/maintenance/restore");
    expect(document.paths).toHaveProperty("/api/v1/maintenance/clear-posts");
  });

  it("persists administrator settings and exposes only non-sensitive settings publicly", async () => {
    const app = createApp({ tokenVerifier: adminVerifier });
    const publicResponse = await app.request(
      "/api/v1/settings/public",
      {},
      env,
    );
    expect(publicResponse.status).toBe(200);
    await expect(publicResponse.json()).resolves.toMatchObject({
      site: { showName: true, name: "Moments", description: "" },
      features: { statistics: true, random: true, rss: true },
      content: { public: true, pageSize: 20 },
    });

    expect(
      (await createApp().request("/api/v1/settings", {}, env)).status,
    ).toBe(401);

    const updateResponse = await app.request(
      "/api/v1/settings",
      jsonRequest("PATCH", {
        site: {
          showName: false,
          name: "我的 Moments",
          description: "记录每一天",
        },
        content: { pageSize: 7 },
      }),
      env,
    );
    expect(updateResponse.status).toBe(200);
    await expect(updateResponse.json()).resolves.toMatchObject({
      site: {
        showName: false,
        name: "我的 Moments",
        description: "记录每一天",
      },
      content: { public: true, pageSize: 7 },
    });

    const persisted = await app.request(
      "/api/v1/settings",
      jsonRequest("GET"),
      env,
    );
    await expect(persisted.json()).resolves.toMatchObject({
      site: { name: "我的 Moments" },
      content: { pageSize: 7 },
    });
  });

  it("enforces feature switches in routes and statistics triggers", async () => {
    const app = createApp({ tokenVerifier: adminVerifier });
    const disabledResponse = await app.request(
      "/api/v1/settings",
      jsonRequest("PATCH", {
        features: { statistics: false, random: false, rss: false },
      }),
      env,
    );
    expect(disabledResponse.status).toBe(200);

    const created = await app.request(
      "/api/v1/posts",
      jsonRequest("POST", { content: "关闭统计后发布" }),
      env,
    );
    expect(created.status).toBe(201);
    await expect(
      env.DB.prepare("SELECT COUNT(*) AS count FROM statistics_daily").first(),
    ).resolves.toEqual({ count: 0 });

    for (const path of ["/api/v1/statistics", "/api/v1/random", "/rss.xml"]) {
      const response = await app.request(
        path,
        path === "/api/v1/statistics" ? jsonRequest("GET") : {},
        env,
      );
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "FEATURE_DISABLED" },
      });
    }

    const enabledResponse = await app.request(
      "/api/v1/settings",
      jsonRequest("PATCH", { features: { statistics: true } }),
      env,
    );
    expect(enabledResponse.status).toBe(200);
    await expect(
      env.DB.prepare("SELECT post_count FROM statistics_daily").first(),
    ).resolves.toEqual({ post_count: 1 });
  });

  it("requires administrator access when content is not public and uses the configured page size", async () => {
    const app = createApp({ tokenVerifier: adminVerifier });
    for (const content of ["第一条", "第二条", "第三条"]) {
      expect(
        (
          await app.request(
            "/api/v1/posts",
            jsonRequest("POST", { content }),
            env,
          )
        ).status,
      ).toBe(201);
    }

    await app.request(
      "/api/v1/settings",
      jsonRequest("PATCH", { content: { pageSize: 1 } }),
      env,
    );
    const oneItem = await app.request("/api/v1/posts", {}, env);
    expect(oneItem.status).toBe(200);
    await expect(oneItem.json()).resolves.toMatchObject({
      items: [{ content: "第三条" }],
    });

    await app.request(
      "/api/v1/settings",
      jsonRequest("PATCH", { content: { public: false } }),
      env,
    );
    expect((await app.request("/api/v1/posts", {}, env)).status).toBe(401);
    expect(
      (
        await createApp({ tokenVerifier: nonAdminVerifier }).request(
          "/api/v1/posts",
          jsonRequest("GET"),
          env,
        )
      ).status,
    ).toBe(403);
    const administratorRead = await app.request(
      "/api/v1/posts",
      jsonRequest("GET"),
      env,
    );
    expect(administratorRead.status).toBe(200);
  });

  it("exports a complete backup and clears data only after origin and image deletion checks", async () => {
    const deletedImages: string[][] = [];
    const app = createApp({
      tokenVerifier: adminVerifier,
      imageDeleter: (images) => {
        deletedImages.push(images);
        return Promise.resolve();
      },
    });
    const image = "https://file.example.com/file/clear.png";
    await app.request(
      "/api/v1/posts",
      jsonRequest("POST", { content: "等待备份", images: [image] }),
      env,
    );

    const backupResponse = await app.request(
      "/api/v1/maintenance/backup",
      jsonRequest("GET"),
      env,
    );
    expect(backupResponse.status).toBe(200);
    await expect(backupResponse.json()).resolves.toMatchObject({
      version: 1,
      posts: [{ content: "等待备份", images: [image], deletedAt: null }],
    });

    const directResponse = await app.request(
      "/api/v1/maintenance/clear-posts",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer test-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ confirmation: "确认清空全部说说" }),
      },
      env,
    );
    expect(directResponse.status).toBe(403);

    const invalidConfirmation = await app.request(
      "/api/v1/maintenance/clear-posts",
      jsonRequest("POST", { confirmation: "清空" }),
      env,
    );
    expect(invalidConfirmation.status).toBe(422);

    const clearResponse = await app.request(
      "/api/v1/maintenance/clear-posts",
      jsonRequest("POST", { confirmation: "确认清空全部说说" }),
      env,
    );
    expect(clearResponse.status).toBe(200);
    await expect(clearResponse.json()).resolves.toEqual({
      deletedPosts: 1,
      deletedImages: 1,
    });
    expect(deletedImages).toEqual([[image]]);
    await expect(
      env.DB.prepare("SELECT COUNT(*) AS count FROM posts").first(),
    ).resolves.toEqual({ count: 0 });
  });

  it("previews backup conflicts and restores atomically only after overwrite confirmation", async () => {
    const app = createApp({ tokenVerifier: adminVerifier });
    const firstId = "11111111-1111-4111-8111-111111111111";
    const secondId = "22222222-2222-4222-8222-222222222222";
    const createdAt = "2026-08-20T00:00:00.000Z";
    const updatedAt = "2026-08-20T01:00:00.000Z";
    const deletedAt = "2026-08-21T00:00:00.000Z";
    const backup = {
      version: 1,
      exportedAt: "2026-08-22T00:00:00.000Z",
      settings: {
        site: {
          showName: true,
          name: "备份站点",
          description: "来自备份",
        },
        features: { statistics: true, random: false, rss: true },
        content: { public: false, pageSize: 12 },
        updatedAt: "2026-08-22T00:00:00.000Z",
      },
      posts: [
        {
          id: firstId,
          content: "备份中的版本",
          images: [
            "https://file.example.com/file/first.png",
            "https://file.example.com/file/second.png",
          ],
          createdAt,
          updatedAt: createdAt,
          edited: false,
          deletedAt: null,
        },
      ],
    } as const;

    const noConflictPreview = await app.request(
      "/api/v1/maintenance/restore/preview",
      jsonRequest("POST", { backup }),
      env,
    );
    expect(noConflictPreview.status).toBe(200);
    await expect(noConflictPreview.json()).resolves.toEqual({
      totalPosts: 1,
      conflictCount: 0,
      conflictIds: [],
      settingsWillBeRestored: true,
    });

    const firstRestore = await app.request(
      "/api/v1/maintenance/restore",
      jsonRequest("POST", { backup, overwriteConflicts: false }),
      env,
    );
    expect(firstRestore.status).toBe(200);
    await expect(firstRestore.json()).resolves.toMatchObject({
      restoredPosts: 1,
      insertedPosts: 1,
      overwrittenPosts: 0,
      settings: { site: { name: "备份站点" } },
    });

    await env.DB.batch([
      env.DB.prepare("UPDATE posts SET content = ? WHERE id = ?").bind(
        "数据库中的现有版本",
        firstId,
      ),
      env.DB.prepare("UPDATE settings SET site_name = ? WHERE id = 1").bind(
        "当前站点",
      ),
    ]);
    const conflictingBackup = {
      ...backup,
      posts: [
        ...backup.posts,
        {
          id: secondId,
          content: "已删除的新增记录",
          images: [],
          createdAt,
          updatedAt,
          edited: true,
          deletedAt,
        },
      ],
    };

    const directPreview = await app.request(
      "/api/v1/maintenance/restore/preview",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer test-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ backup: conflictingBackup }),
      },
      env,
    );
    expect(directPreview.status).toBe(403);

    const conflictPreview = await app.request(
      "/api/v1/maintenance/restore/preview",
      jsonRequest("POST", { backup: conflictingBackup }),
      env,
    );
    expect(conflictPreview.status).toBe(200);
    await expect(conflictPreview.json()).resolves.toEqual({
      totalPosts: 2,
      conflictCount: 1,
      conflictIds: [firstId],
      settingsWillBeRestored: true,
    });

    const rejectedRestore = await app.request(
      "/api/v1/maintenance/restore",
      jsonRequest("POST", {
        backup: conflictingBackup,
        overwriteConflicts: false,
      }),
      env,
    );
    expect(rejectedRestore.status).toBe(409);
    await expect(rejectedRestore.json()).resolves.toMatchObject({
      error: { code: "BACKUP_CONFLICT" },
    });
    await expect(
      env.DB.prepare("SELECT content FROM posts WHERE id = ?")
        .bind(firstId)
        .first(),
    ).resolves.toEqual({ content: "数据库中的现有版本" });
    await expect(
      env.DB.prepare("SELECT id FROM posts WHERE id = ?").bind(secondId).first(),
    ).resolves.toBeNull();
    await expect(
      env.DB.prepare("SELECT site_name FROM settings WHERE id = 1").first(),
    ).resolves.toEqual({ site_name: "当前站点" });

    const confirmedRestore = await app.request(
      "/api/v1/maintenance/restore",
      jsonRequest("POST", {
        backup: conflictingBackup,
        overwriteConflicts: true,
      }),
      env,
    );
    expect(confirmedRestore.status).toBe(200);
    await expect(confirmedRestore.json()).resolves.toMatchObject({
      restoredPosts: 2,
      insertedPosts: 1,
      overwrittenPosts: 1,
      settings: { site: { name: "备份站点" } },
    });
    await expect(
      env.DB.prepare(
        "SELECT content, images_json, deleted_at FROM posts WHERE id = ?",
      )
        .bind(firstId)
        .first(),
    ).resolves.toEqual({
      content: "备份中的版本",
      images_json: JSON.stringify(backup.posts[0].images),
      deleted_at: null,
    });
    await expect(
      env.DB.prepare("SELECT deleted_at FROM posts WHERE id = ?")
        .bind(secondId)
        .first(),
    ).resolves.toEqual({ deleted_at: deletedAt });
    await expect(
      env.DB.prepare("SELECT COUNT(*) AS count FROM public_post_slots").first(),
    ).resolves.toEqual({ count: 1 });
    await expect(
      env.DB.prepare("SELECT post_count FROM statistics_daily").first(),
    ).resolves.toEqual({ post_count: 1 });
    await expect(
      env.DB.prepare(
        "SELECT site_name, random_enabled, content_public, page_size FROM settings WHERE id = 1",
      ).first(),
    ).resolves.toEqual({
      site_name: "备份站点",
      random_enabled: 0,
      content_public: 0,
      page_size: 12,
    });
  });

  it("rejects malformed backups before querying or writing D1", async () => {
    const id = "33333333-3333-4333-8333-333333333333";
    const timestamp = "2026-08-22T00:00:00.000Z";
    const post = {
      id,
      content: "重复 ID",
      images: [],
      createdAt: timestamp,
      updatedAt: timestamp,
      edited: false,
      deletedAt: null,
    };
    const response = await createApp({ tokenVerifier: adminVerifier }).request(
      "/api/v1/maintenance/restore/preview",
      jsonRequest("POST", {
        backup: {
          version: 1,
          exportedAt: timestamp,
          settings: {
            site: { showName: true, name: "Moments", description: "" },
            features: { statistics: true, random: true, rss: true },
            content: { public: true, pageSize: 20 },
            updatedAt: timestamp,
          },
          posts: [post, post],
        },
      }),
      env,
    );
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
  });

  it("requires Clerk authentication for writes", async () => {
    const response = await createApp().request(
      "/api/v1/posts",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "x" }),
      },
      env,
    );
    expect(response.status).toBe(401);
  });

  it("rejects an authenticated non-administrator", async () => {
    const response = await createApp({
      tokenVerifier: nonAdminVerifier,
    }).request("/api/v1/posts", jsonRequest("POST", { content: "x" }), env);
    expect(response.status).toBe(403);
  });

  it("creates image-only posts and adds images without replacing them", async () => {
    const app = createApp({
      tokenVerifier: adminVerifier,
      imageDeleter: () => Promise.resolve(),
    });
    const originalImage = "https://file.vacu.top/file/test.png";
    const addedImage = "https://file.vacu.top/file/updated.png";
    const response = await app.request(
      "/api/v1/posts",
      jsonRequest("POST", {
        content: "",
        images: [originalImage],
      }),
      env,
    );
    expect(response.status).toBe(201);
    const created = await response.json<{
      id: string;
      content: string;
      images: string[];
    }>();
    expect(created.content).toBe("");
    expect(created.images).toEqual([originalImage]);

    const updatedResponse = await app.request(
      `/api/v1/posts/${created.id}`,
      jsonRequest("PATCH", {
        content: "增加文字",
        images: [originalImage, addedImage],
      }),
      env,
    );
    expect(updatedResponse.status).toBe(200);
    await expect(updatedResponse.json()).resolves.toMatchObject({
      content: "增加文字",
      images: [originalImage, addedImage],
    });

    const removedResponse = await app.request(
      `/api/v1/posts/${created.id}/images`,
      jsonRequest("DELETE", { imageUrl: originalImage }),
      env,
    );
    expect(removedResponse.status).toBe(200);
    await expect(removedResponse.json()).resolves.toMatchObject({
      images: [addedImage],
    });

    const emptyResponse = await app.request(
      `/api/v1/posts/${created.id}`,
      jsonRequest("PATCH", { content: "", images: [] }),
      env,
    );
    expect(emptyResponse.status).toBe(422);
  });

  it("deletes a hosted image before detaching it from a post", async () => {
    const deletedImages: string[][] = [];
    const app = createApp({
      tokenVerifier: adminVerifier,
      imageDeleter: (images) => {
        deletedImages.push(images);
        return Promise.resolve();
      },
    });
    const oldImage = "https://file.vacu.top/file/moments/old.png";
    const keptImage = "https://file.vacu.top/file/moments/kept.png";
    const newImage = "https://file.vacu.top/file/moments/new.png";
    const createResponse = await app.request(
      "/api/v1/posts",
      jsonRequest("POST", {
        content: "图片生命周期",
        images: [oldImage, keptImage],
      }),
      env,
    );
    const post = await createResponse.json<{ id: string }>();

    const bypassResponse = await app.request(
      `/api/v1/posts/${post.id}`,
      jsonRequest("PATCH", {
        content: "不能绕过删除接口",
        images: [keptImage],
      }),
      env,
    );
    expect(bypassResponse.status).toBe(409);

    const additiveResponse = await app.request(
      `/api/v1/posts/${post.id}`,
      jsonRequest("PATCH", {
        content: "允许添加图片",
        images: [oldImage, keptImage, newImage],
      }),
      env,
    );
    expect(additiveResponse.status).toBe(200);

    const deleteResponse = await app.request(
      `/api/v1/posts/${post.id}/images`,
      jsonRequest("DELETE", { imageUrl: oldImage }),
      env,
    );
    expect(deleteResponse.status).toBe(200);
    await expect(deleteResponse.json()).resolves.toMatchObject({
      images: [keptImage, newImage],
    });
    expect(deletedImages).toEqual([[oldImage]]);
    await expect(
      env.DB.prepare("SELECT images_json FROM posts WHERE id = ?")
        .bind(post.id)
        .first<{ images_json: string }>(),
    ).resolves.toEqual({ images_json: JSON.stringify([keptImage, newImage]) });
  });

  it("keeps an attached image when hosted deletion fails", async () => {
    const image = "https://file.vacu.top/file/moments/retry-edit.png";
    const app = createApp({
      tokenVerifier: adminVerifier,
      imageDeleter: () =>
        Promise.reject(
          new ApiError(
            502,
            "IMAGE_DELETE_FAILED",
            "Hosted image deletion failed.",
          ),
        ),
    });
    const createResponse = await app.request(
      "/api/v1/posts",
      jsonRequest("POST", { content: "删除失败时保留", images: [image] }),
      env,
    );
    const post = await createResponse.json<{ id: string }>();
    const response = await app.request(
      `/api/v1/posts/${post.id}/images`,
      jsonRequest("DELETE", { imageUrl: image }),
      env,
    );
    expect(response.status).toBe(502);
    await expect(
      env.DB.prepare("SELECT images_json FROM posts WHERE id = ?")
        .bind(post.id)
        .first<{ images_json: string }>(),
    ).resolves.toEqual({ images_json: JSON.stringify([image]) });
  });

  it("serves an RSS 2.0 feed limited to the latest twenty Shanghai days", async () => {
    const now = new Date();
    const recentAt = now.toISOString();
    const expiredAt = new Date(
      now.getTime() - 20 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const recentId = "99999999-9999-4999-8999-999999999991";
    const expiredId = "99999999-9999-4999-8999-999999999992";
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO posts (id, content, images_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).bind(
        recentId,
        "RSS <内容> & 订阅",
        JSON.stringify(["https://file.example.com/file/rss.png"]),
        recentAt,
        recentAt,
      ),
      env.DB.prepare(
        `INSERT INTO posts (id, content, images_json, created_at, updated_at)
         VALUES (?, '过期内容', '[]', ?, ?)`,
      ).bind(expiredId, expiredAt, expiredAt),
    ]);

    const response = await createApp().request("/rss.xml", {}, env);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain(
      "application/rss+xml",
    );
    const rss = await response.text();
    expect(rss).toContain('<rss version="2.0"');
    expect(rss).toContain(`urn:uuid:${recentId}`);
    expect(rss).not.toContain(expiredId);
    expect(rss).toContain("RSS &lt;内容&gt; &amp; 订阅");
    expect(rss).toContain(`${env.ALLOWED_ORIGIN}/rss.xml`);
  });

  it("creates, normalizes, updates, navigates, paginates and soft-deletes posts", async () => {
    const app = createApp({ tokenVerifier: adminVerifier });
    const firstResponse = await app.request(
      "/api/v1/posts",
      jsonRequest("POST", {
        content: "  第一条   🙂\n\nhttps://example.com  ",
      }),
      env,
    );
    expect(firstResponse.status).toBe(201);
    const first = await firstResponse.json<{
      id: string;
      content: string;
      images: string[];
    }>();
    expect(first.content).toBe("第一条 🙂\nhttps://example.com");
    expect(first.images).toEqual([]);

    await new Promise((resolve) => setTimeout(resolve, 2));
    const secondResponse = await app.request(
      "/api/v1/posts",
      jsonRequest("POST", { content: "第二条" }),
      env,
    );
    const second = await secondResponse.json<{ id: string }>();

    const pageOneResponse = await app.request("/api/v1/posts?limit=1", {}, env);
    const pageOne = await pageOneResponse.json<{
      items: Array<{ id: string }>;
      nextCursor: string | null;
    }>();
    expect(pageOne.items[0]?.id).toBe(second.id);
    expect(pageOne.nextCursor).not.toBeNull();

    const pageTwoResponse = await app.request(
      `/api/v1/posts?limit=1&cursor=${encodeURIComponent(pageOne.nextCursor ?? "")}`,
      {},
      env,
    );
    const pageTwo = await pageTwoResponse.json<{
      items: Array<{ id: string }>;
    }>();
    expect(pageTwo.items[0]?.id).toBe(first.id);

    const detailResponse = await app.request(
      `/api/v1/posts/${first.id}`,
      {},
      env,
    );
    const detail = await detailResponse.json<{
      navigation: { newerId: string | null; olderId: string | null };
    }>();
    expect(detail.navigation.newerId).toBe(second.id);
    expect(detail.navigation.olderId).toBeNull();

    const sharedTimestamp = "2026-08-08T00:00:00.000Z";
    const tiedIds = [
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
    ] as const;
    await env.DB.batch(
      tiedIds.map((id) =>
        env.DB.prepare(
          `INSERT INTO posts (id, content, images_json, created_at, updated_at)
           VALUES (?, ?, '[]', ?, ?)`,
        ).bind(id, id, sharedTimestamp, sharedTimestamp),
      ),
    );
    const tiedDetailResponse = await app.request(
      `/api/v1/posts/${tiedIds[1]}`,
      {},
      env,
    );
    const tiedDetail = await tiedDetailResponse.json<{
      navigation: { newerId: string | null; olderId: string | null };
    }>();
    expect(tiedDetail.navigation).toEqual({
      newerId: tiedIds[2],
      olderId: tiedIds[0],
    });

    const updateResponse = await app.request(
      `/api/v1/posts/${first.id}`,
      jsonRequest("PATCH", { content: "更新   后" }),
      env,
    );
    const updated = await updateResponse.json<{
      content: string;
      edited: boolean;
    }>();
    expect(updated).toMatchObject({ content: "更新 后", edited: true });

    const deleteResponse = await app.request(
      `/api/v1/posts/${first.id}`,
      jsonRequest("DELETE"),
      env,
    );
    expect(deleteResponse.status).toBe(204);

    const missingResponse = await app.request(
      `/api/v1/posts/${first.id}`,
      {},
      env,
    );
    expect(missingResponse.status).toBe(404);

    const restoreResponse = await app.request(
      `/api/v1/posts/${first.id}/restore`,
      jsonRequest("POST"),
      env,
    );
    expect(restoreResponse.status).toBe(200);
    await expect(restoreResponse.json()).resolves.toMatchObject({
      id: first.id,
      content: "更新 后",
    });

    const duplicateRestoreResponse = await app.request(
      `/api/v1/posts/${first.id}/restore`,
      jsonRequest("POST"),
      env,
    );
    expect(duplicateRestoreResponse.status).toBe(409);

    const secondDeleteResponse = await app.request(
      `/api/v1/posts/${first.id}`,
      jsonRequest("DELETE"),
      env,
    );
    expect(secondDeleteResponse.status).toBe(204);

    const stored = await env.DB.prepare(
      "SELECT deleted_at FROM posts WHERE id = ?",
    )
      .bind(first.id)
      .first<{ deleted_at: string | null }>();
    expect(stored?.deleted_at).not.toBeNull();
  });

  it("groups and navigates posts by Asia/Shanghai date and anchors feed pagination", async () => {
    const rows = [
      [
        "11111111-1111-4111-8111-111111111111",
        "较早日期",
        "2026-08-06T15:59:59.999Z",
      ],
      [
        "22222222-2222-4222-8222-222222222222",
        "当天较早",
        "2026-08-06T16:00:00.000Z",
      ],
      [
        "33333333-3333-4333-8333-333333333333",
        "当天较新",
        "2026-08-07T15:59:59.999Z",
      ],
      [
        "44444444-4444-4444-8444-444444444444",
        "较新日期",
        "2026-08-07T16:00:00.000Z",
      ],
    ] as const;
    await env.DB.batch(
      rows.map(([id, content, createdAt]) =>
        env.DB.prepare(
          `INSERT INTO posts (id, content, images_json, created_at, updated_at)
       VALUES (?, ?, '[]', ?, ?)`,
        ).bind(id, content, createdAt, createdAt),
      ),
    );

    const app = createApp();
    const detailResponse = await app.request(
      "/api/v1/posts?date=2026-08-07",
      {},
      env,
    );
    expect(detailResponse.status).toBe(200);
    const detail = await detailResponse.json<{
      date: string;
      items: Array<{ id: string }>;
      nextCursor: string | null;
      navigation: { newerDate: string | null; olderDate: string | null };
    }>();
    expect(detail.date).toBe("2026-08-07");
    expect(detail.nextCursor).toBeNull();
    expect(detail.items.map((item) => item.id)).toEqual([
      rows[2][0],
      rows[1][0],
    ]);
    expect(detail.navigation).toEqual({
      newerDate: "2026-08-08",
      olderDate: "2026-08-06",
    });

    const anchoredResponse = await app.request(
      "/api/v1/posts?limit=3&anchorDate=2026-08-07",
      {},
      env,
    );
    const anchored = await anchoredResponse.json<{
      items: Array<{ id: string }>;
      nextCursor: string | null;
    }>();
    expect(anchored.items.map((item) => item.id)).toEqual([
      rows[2][0],
      rows[1][0],
      rows[0][0],
    ]);
    expect(anchored.items.some((item) => item.id === rows[3][0])).toBe(false);

    const conflictResponse = await app.request(
      `/api/v1/posts?cursor=${encodeURIComponent(anchored.nextCursor ?? "unused")}&anchorDate=2026-08-07`,
      {},
      env,
    );
    expect(conflictResponse.status).toBe(422);

    const dateWithCursorResponse = await app.request(
      `/api/v1/posts?date=2026-08-07&cursor=${encodeURIComponent(anchored.nextCursor ?? "unused")}`,
      {},
      env,
    );
    expect(dateWithCursorResponse.status).toBe(422);

    expect(
      (await app.request("/api/v1/posts?date=2026-02-30", {}, env)).status,
    ).toBe(422);
    expect(
      (await app.request("/api/v1/posts?date=2026-08-09", {}, env)).status,
    ).toBe(404);
    expect(
      (await app.request("/api/v1/dates/2026-08-07", {}, env)).status,
    ).toBe(404);
  });

  it("returns daily statistics and an administrator narrative in Asia/Shanghai while excluding deleted posts", async () => {
    const rows = [
      [
        "66666666-6666-4666-8666-666666666661",
        "第一天",
        "2026-08-06T15:59:59.999Z",
        null,
      ],
      [
        "66666666-6666-4666-8666-666666666662",
        "第二天一",
        "2026-08-06T16:00:00.000Z",
        null,
      ],
      [
        "66666666-6666-4666-8666-666666666663",
        "第二天二",
        "2026-08-07T15:59:59.999Z",
        null,
      ],
      [
        "66666666-6666-4666-8666-666666666664",
        "已删除",
        "2026-08-07T16:00:00.000Z",
        "2026-08-08T00:00:00.000Z",
      ],
    ] as const;
    await env.DB.batch(
      rows.map(([id, content, createdAt, deletedAt]) =>
        env.DB.prepare(
          `INSERT INTO posts (id, content, images_json, created_at, updated_at, deleted_at)
           VALUES (?, ?, '[]', ?, ?, ?)`,
        ).bind(id, content, createdAt, createdAt, deletedAt),
      ),
    );

    const response = await createApp({ tokenVerifier: adminVerifier }).request(
      "/api/v1/statistics",
      jsonRequest("GET"),
      env,
    );
    expect(response.status).toBe(200);
    const statistics = await response.json<{
      days: Array<{ date: string; count: number }>;
      administratorNarrative: Array<{
        segments: Array<{ text: string; bold: boolean }>;
      }>;
    }>();
    expect(statistics.days).toEqual([
      { date: "2026-08-06", count: 1 },
      { date: "2026-08-07", count: 2 },
    ]);
    expect(statistics.administratorNarrative).toEqual([
      {
        segments: [
          {
            text: "坚持下去，Moments正在为你统计数据",
            bold: false,
          },
        ],
      },
    ]);
    const narrativeText = statistics.administratorNarrative
      .flatMap((paragraph) => paragraph.segments)
      .map((segment) => segment.text)
      .join("");
    expect(narrativeText).not.toContain("一共写下了");
    expect(narrativeText).not.toContain("已删除");
  });

  it("maintains statistics aggregates incrementally across writes", async () => {
    const app = createApp({
      tokenVerifier: adminVerifier,
      imageDeleter: () => Promise.resolve(),
    });
    const imageA = "https://file.vacu.top/file/moments/a.png";
    const imageB = "https://file.vacu.top/file/moments/b.png";

    async function readDaily(): Promise<{
      post_count: number;
      character_count: number;
      longest_post_characters: number;
      image_count: number;
    } | null> {
      return env.DB.prepare(
        "SELECT post_count, character_count, longest_post_characters, image_count FROM statistics_daily",
      ).first();
    }

    const firstResponse = await app.request(
      "/api/v1/posts",
      jsonRequest("POST", { content: "一二三", images: [imageA, imageB] }),
      env,
    );
    const first = await firstResponse.json<{ id: string }>();

    // Without the version marker, reads aggregate posts directly and stay fresh.
    const initial = await app.request(
      "/api/v1/statistics",
      jsonRequest("GET"),
      env,
    );
    expect(initial.status).toBe(200);
    expect(await readDaily()).toEqual({
      post_count: 1,
      character_count: 3,
      longest_post_characters: 3,
      image_count: 2,
    });

    const secondResponse = await app.request(
      "/api/v1/posts",
      jsonRequest("POST", { content: "四" }),
      env,
    );
    const second = await secondResponse.json<{ id: string }>();

    const updateResponse = await app.request(
      `/api/v1/posts/${first.id}`,
      jsonRequest("PATCH", {
        content: "五个字了",
        images: [imageA, imageB],
      }),
      env,
    );
    expect(updateResponse.status).toBe(200);
    const imageDeleteResponse = await app.request(
      `/api/v1/posts/${first.id}/images`,
      jsonRequest("DELETE", { imageUrl: imageB }),
      env,
    );
    expect(imageDeleteResponse.status).toBe(200);
    expect(await readDaily()).toEqual({
      post_count: 2,
      character_count: 5,
      longest_post_characters: 4,
      image_count: 1,
    });

    await app.request(`/api/v1/posts/${second.id}`, jsonRequest("DELETE"), env);
    expect(await readDaily()).toEqual({
      post_count: 1,
      character_count: 4,
      longest_post_characters: 4,
      image_count: 1,
    });

    await app.request(
      `/api/v1/posts/${second.id}/restore`,
      jsonRequest("POST"),
      env,
    );
    expect(await readDaily()).toEqual({
      post_count: 2,
      character_count: 5,
      longest_post_characters: 4,
      image_count: 1,
    });

    // The rebuild endpoint recomputes the same aggregates from posts.
    const rebuildResponse = await app.request(
      "/api/v1/statistics/rebuild",
      jsonRequest("POST"),
      env,
    );
    expect(rebuildResponse.status).toBe(200);
    expect(await readDaily()).toEqual({
      post_count: 2,
      character_count: 5,
      longest_post_characters: 4,
      image_count: 1,
    });
    const [rebuilt, reread] = await Promise.all([
      rebuildResponse.json<{ days: Array<{ date: string; count: number }> }>(),
      (await app.request("/api/v1/statistics", jsonRequest("GET"), env)).json<{
        days: Array<{ date: string; count: number }>;
      }>(),
    ]);
    expect(rebuilt.days).toEqual(reread.days);
    expect(rebuilt.days).toEqual([
      { date: rebuilt.days[0]?.date ?? "", count: 2 },
    ]);
  });

  it("keeps derived data correct for direct SQL writes and dense random slots", async () => {
    const rows = [
      [
        "88888888-8888-4888-8888-888888888881",
        "一",
        "2026-08-01T00:00:00.000Z",
      ],
      [
        "88888888-8888-4888-8888-888888888882",
        "二二",
        "2026-08-01T01:00:00.000Z",
      ],
      [
        "88888888-8888-4888-8888-888888888883",
        "三三三",
        "2026-08-01T02:00:00.000Z",
      ],
    ] as const;
    await env.DB.batch(
      rows.map(([id, content, createdAt]) =>
        env.DB.prepare(
          `INSERT INTO posts (id, content, images_json, created_at, updated_at)
           VALUES (?, ?, '[]', ?, ?)`,
        ).bind(id, content, createdAt, createdAt),
      ),
    );

    async function readSlots() {
      return (
        await env.DB.prepare(
          "SELECT slot, post_id FROM public_post_slots ORDER BY slot",
        ).all<{ slot: number; post_id: string }>()
      ).results;
    }

    expect(await readSlots()).toEqual([
      { slot: 1, post_id: rows[0][0] },
      { slot: 2, post_id: rows[1][0] },
      { slot: 3, post_id: rows[2][0] },
    ]);

    await env.DB.prepare("UPDATE posts SET deleted_at = ? WHERE id = ?")
      .bind("2026-08-02T00:00:00.000Z", rows[1][0])
      .run();
    expect(await readSlots()).toEqual([
      { slot: 1, post_id: rows[0][0] },
      { slot: 2, post_id: rows[2][0] },
    ]);

    await env.DB.prepare(
      "UPDATE posts SET content = '最长的一篇呀', updated_at = ? WHERE id = ?",
    )
      .bind("2026-08-02T00:00:01.000Z", rows[2][0])
      .run();
    await env.DB.prepare("UPDATE posts SET deleted_at = NULL WHERE id = ?")
      .bind(rows[1][0])
      .run();

    expect((await readSlots()).map(({ slot }) => slot)).toEqual([1, 2, 3]);
    await expect(
      env.DB.prepare(
        `SELECT post_count, character_count, longest_post_characters
         FROM statistics_daily
         WHERE date = '2026-08-01'`,
      ).first(),
    ).resolves.toEqual({
      post_count: 3,
      character_count: 9,
      longest_post_characters: 6,
    });

    await env.DB.prepare(
      "UPDATE posts SET content = '短', updated_at = ? WHERE id = ?",
    )
      .bind("2026-08-02T00:00:02.000Z", rows[2][0])
      .run();
    await expect(
      env.DB.prepare(
        `SELECT post_count, character_count, longest_post_characters
         FROM statistics_daily
         WHERE date = '2026-08-01'`,
      ).first(),
    ).resolves.toEqual({
      post_count: 3,
      character_count: 4,
      longest_post_characters: 2,
    });
  });

  it("protects statistics reads and rebuilds with administrator authentication", async () => {
    const unauthenticatedRead = await createApp().request(
      "/api/v1/statistics",
      {},
      env,
    );
    expect(unauthenticatedRead.status).toBe(401);

    const forbiddenRead = await createApp({
      tokenVerifier: nonAdminVerifier,
    }).request("/api/v1/statistics", jsonRequest("GET"), env);
    expect(forbiddenRead.status).toBe(403);

    const unauthenticatedRebuild = await createApp().request(
      "/api/v1/statistics/rebuild",
      { method: "POST" },
      env,
    );
    expect(unauthenticatedRebuild.status).toBe(401);

    const forbiddenRebuild = await createApp({
      tokenVerifier: nonAdminVerifier,
    }).request("/api/v1/statistics/rebuild", jsonRequest("POST"), env);
    expect(forbiddenRebuild.status).toBe(403);
  });

  it("rejects posts with more than eighteen images", async () => {
    const images = Array.from(
      { length: 19 },
      (_, index) =>
        `https://file.vacu.top/file/moments/image-${String(index)}.png`,
    );
    const response = await createApp({ tokenVerifier: adminVerifier }).request(
      "/api/v1/posts",
      jsonRequest("POST", { content: "太多了", images }),
      env,
    );
    expect(response.status).toBe(422);
  });

  it("returns all posts from the date selected by the random endpoint", async () => {
    const rows = [
      [
        "77777777-7777-4777-8777-777777777771",
        "第一天",
        "2026-08-06T15:59:59.999Z",
      ],
      [
        "77777777-7777-4777-8777-777777777772",
        "第二天一",
        "2026-08-06T16:00:00.000Z",
      ],
      [
        "77777777-7777-4777-8777-777777777773",
        "第二天二",
        "2026-08-07T00:00:00.000Z",
      ],
    ] as const;
    await env.DB.batch(
      rows.map(([id, content, createdAt]) =>
        env.DB.prepare(
          `INSERT INTO posts (id, content, images_json, created_at, updated_at)
           VALUES (?, ?, '[]', ?, ?)`,
        ).bind(id, content, createdAt, createdAt),
      ),
    );

    const response = await createApp().request("/api/v1/random", {}, env);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const detail = await response.json<{
      date: string;
      items: Array<{ id: string }>;
    }>();
    expect(["2026-08-06", "2026-08-07"]).toContain(detail.date);
    expect(detail.items.map((item) => item.id)).toEqual(
      detail.date === "2026-08-06" ? [rows[0][0]] : [rows[2][0], rows[1][0]],
    );

    await clearPosts();
    expect((await createApp().request("/api/v1/random", {}, env)).status).toBe(
      404,
    );
  });

  it("protects post restoration with Clerk administrator authentication and CORS", async () => {
    const id = "55555555-5555-4555-8555-555555555555";
    const timestamp = "2026-08-07T00:00:00.000Z";
    await env.DB.prepare(
      `INSERT INTO posts (id, content, images_json, created_at, updated_at, deleted_at)
       VALUES (?, '已删除', '[]', ?, ?, ?)`,
    )
      .bind(id, timestamp, timestamp, timestamp)
      .run();

    const unauthenticated = await createApp().request(
      `/api/v1/posts/${id}/restore`,
      { method: "POST", headers: { Origin: env.ALLOWED_ORIGIN } },
      env,
    );
    expect(unauthenticated.status).toBe(401);

    const forbidden = await createApp({
      tokenVerifier: nonAdminVerifier,
    }).request(`/api/v1/posts/${id}/restore`, jsonRequest("POST"), env);
    expect(forbidden.status).toBe(403);

    const preflight = await createApp().request(
      `/api/v1/posts/${id}/restore`,
      {
        method: "OPTIONS",
        headers: {
          Origin: env.ALLOWED_ORIGIN,
          "Access-Control-Request-Method": "POST",
        },
      },
      env,
    );
    expect(preflight.status).toBe(204);
  });

  it("lists, restores and permanently deletes posts in the trash", async () => {
    const deletedImageBatches: string[][] = [];
    const app = createApp({
      tokenVerifier: adminVerifier,
      imageDeleter: (images) => {
        deletedImageBatches.push(images);
        return Promise.resolve();
      },
    });
    const firstResponse = await app.request(
      "/api/v1/posts",
      jsonRequest("POST", { content: "恢复我" }),
      env,
    );
    const first = await firstResponse.json<{ id: string }>();
    const secondResponse = await app.request(
      "/api/v1/posts",
      jsonRequest("POST", {
        content: "永久删除我",
        images: ["https://file.vacu.top/file/moments/delete-me.png"],
      }),
      env,
    );
    const second = await secondResponse.json<{ id: string }>();

    await app.request(`/api/v1/posts/${first.id}`, jsonRequest("DELETE"), env);
    await new Promise((resolve) => setTimeout(resolve, 2));
    await app.request(`/api/v1/posts/${second.id}`, jsonRequest("DELETE"), env);

    const unauthenticated = await createApp().request(
      "/api/v1/trash",
      { headers: { Origin: env.ALLOWED_ORIGIN } },
      env,
    );
    expect(unauthenticated.status).toBe(401);

    const forbidden = await createApp({
      tokenVerifier: nonAdminVerifier,
    }).request("/api/v1/trash", jsonRequest("GET"), env);
    expect(forbidden.status).toBe(403);

    const listResponse = await app.request(
      "/api/v1/trash?limit=1",
      jsonRequest("GET"),
      env,
    );
    expect(listResponse.status).toBe(200);
    const trash = await listResponse.json<{
      items: Array<{ id: string; deletedAt: string }>;
      nextCursor: string | null;
    }>();
    expect(trash.items.map((item) => item.id)).toEqual([second.id]);
    expect(trash.items.every((item) => item.deletedAt.length > 0)).toBe(true);
    expect(trash.nextCursor).not.toBeNull();

    const secondPageResponse = await app.request(
      `/api/v1/trash?limit=1&cursor=${encodeURIComponent(trash.nextCursor ?? "")}`,
      jsonRequest("GET"),
      env,
    );
    const secondPage = await secondPageResponse.json<{
      items: Array<{ id: string }>;
      nextCursor: string | null;
    }>();
    expect(secondPage.items.map((item) => item.id)).toEqual([first.id]);
    expect(secondPage.nextCursor).toBeNull();

    expect(
      (
        await app.request(
          `/api/v1/posts/${first.id}/restore`,
          jsonRequest("POST"),
          env,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(
          `/api/v1/trash/${second.id}`,
          jsonRequest("DELETE"),
          env,
        )
      ).status,
    ).toBe(204);
    expect(
      (
        await app.request(
          `/api/v1/trash/${first.id}`,
          jsonRequest("DELETE"),
          env,
        )
      ).status,
    ).toBe(409);

    const remainingResponse = await app.request(
      "/api/v1/trash",
      jsonRequest("GET"),
      env,
    );
    await expect(remainingResponse.json()).resolves.toMatchObject({
      items: [],
    });
    const deletedRow = await env.DB.prepare("SELECT id FROM posts WHERE id = ?")
      .bind(second.id)
      .first<{ id: string }>();
    expect(deletedRow).toBeNull();
    expect(deletedImageBatches).toEqual([
      ["https://file.vacu.top/file/moments/delete-me.png"],
    ]);
  });

  it("keeps a trashed post when hosted image deletion fails", async () => {
    const app = createApp({
      tokenVerifier: adminVerifier,
      imageDeleter: () =>
        Promise.reject(
          new ApiError(
            502,
            "IMAGE_DELETE_FAILED",
            "Hosted image deletion failed.",
          ),
        ),
    });
    const createResponse = await app.request(
      "/api/v1/posts",
      jsonRequest("POST", {
        content: "保留到重试",
        images: ["https://file.vacu.top/file/moments/retry.png"],
      }),
      env,
    );
    const post = await createResponse.json<{ id: string }>();
    await app.request(`/api/v1/posts/${post.id}`, jsonRequest("DELETE"), env);

    const response = await app.request(
      `/api/v1/trash/${post.id}`,
      jsonRequest("DELETE"),
      env,
    );
    expect(response.status).toBe(502);
    const retained = await env.DB.prepare(
      "SELECT deleted_at FROM posts WHERE id = ?",
    )
      .bind(post.id)
      .first<{ deleted_at: string | null }>();
    expect(retained?.deleted_at).not.toBeNull();
  });

  it("rejects invalid cursors and disallowed browser origins", async () => {
    const invalidCursor = await createApp().request(
      "/api/v1/posts?cursor=bad",
      {},
      env,
    );
    expect(invalidCursor.status).toBe(400);

    const invalidTrashCursor = await createApp({
      tokenVerifier: adminVerifier,
    }).request("/api/v1/trash?cursor=bad", jsonRequest("GET"), env);
    expect(invalidTrashCursor.status).toBe(400);

    const wrongOrigin = await createApp({
      tokenVerifier: adminVerifier,
    }).request(
      "/api/v1/posts",
      {
        ...jsonRequest("POST", { content: "x" }),
        headers: {
          Authorization: "Bearer test-token",
          "Content-Type": "application/json",
          Origin: "https://malicious.example",
        },
      },
      env,
    );
    expect(wrongOrigin.status).toBe(403);
  });
});
