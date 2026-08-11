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
  await env.DB.prepare("DELETE FROM posts").run();
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
    expect(document.paths).toHaveProperty("/api/v1/posts/{id}/restore");
    expect(document.paths).toHaveProperty("/api/v1/dates/{date}");
    expect(document.paths).toHaveProperty("/api/v1/statistics");
    expect(document.paths).toHaveProperty("/api/v1/random");
    expect(document.paths).toHaveProperty("/api/v1/trash");
    expect(document.paths).toHaveProperty("/api/v1/trash/{id}");
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

  it("creates and updates image-only posts", async () => {
    const app = createApp({ tokenVerifier: adminVerifier });
    const response = await createApp({ tokenVerifier: adminVerifier }).request(
      "/api/v1/posts",
      jsonRequest("POST", {
        content: "",
        images: ["https://file.vacu.top/file/test.png"],
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
    expect(created.images).toEqual(["https://file.vacu.top/file/test.png"]);

    const updatedResponse = await app.request(
      `/api/v1/posts/${created.id}`,
      jsonRequest("PATCH", {
        content: "增加文字",
        images: ["https://file.vacu.top/file/updated.png"],
      }),
      env,
    );
    expect(updatedResponse.status).toBe(200);
    await expect(updatedResponse.json()).resolves.toMatchObject({
      content: "增加文字",
      images: ["https://file.vacu.top/file/updated.png"],
    });

    const emptyResponse = await app.request(
      `/api/v1/posts/${created.id}`,
      jsonRequest("PATCH", { content: "", images: [] }),
      env,
    );
    expect(emptyResponse.status).toBe(422);
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
      "/api/v1/dates/2026-08-07",
      {},
      env,
    );
    expect(detailResponse.status).toBe(200);
    const detail = await detailResponse.json<{
      date: string;
      items: Array<{ id: string }>;
      navigation: { newerDate: string | null; olderDate: string | null };
    }>();
    expect(detail.date).toBe("2026-08-07");
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

    expect(
      (await app.request("/api/v1/dates/2026-02-30", {}, env)).status,
    ).toBe(422);
    expect(
      (await app.request("/api/v1/dates/2026-08-09", {}, env)).status,
    ).toBe(404);
  });

  it("returns daily statistics in Asia/Shanghai and excludes deleted posts", async () => {
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

    const response = await createApp().request("/api/v1/statistics", {}, env);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      days: [
        { date: "2026-08-06", count: 1 },
        { date: "2026-08-07", count: 2 },
      ],
      summary: {
        firstDate: "2026-08-06",
        totalPosts: 3,
        activeDays: 2,
        peakDate: "2026-08-07",
        peakPosts: 2,
      },
    });
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
