import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import type { TokenVerifier } from "../src/types";

const adminVerifier: TokenVerifier = () => Promise.resolve({ userId: env.ADMIN_CLERK_USER_ID });
const nonAdminVerifier: TokenVerifier = () => Promise.resolve({ userId: "user_not_admin" });

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
    await expect(response.json()).resolves.toMatchObject({ status: "ok", database: "ok" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("publishes an OpenAPI 3.1 contract", async () => {
    const response = await createApp().request("/openapi.json", {}, env);
    const document = await response.json<{ openapi: string; paths: Record<string, unknown> }>();
    expect(document.openapi).toBe("3.1.0");
    expect(document.paths).toHaveProperty("/api/v1/posts");
    expect(document.paths).toHaveProperty("/api/v1/posts/{id}");
  });

  it("requires Clerk authentication for writes", async () => {
    const response = await createApp().request(
      "/api/v1/posts",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: "x" }) },
      env,
    );
    expect(response.status).toBe(401);
  });

  it("rejects an authenticated non-administrator", async () => {
    const response = await createApp({ tokenVerifier: nonAdminVerifier }).request(
      "/api/v1/posts",
      jsonRequest("POST", { content: "x" }),
      env,
    );
    expect(response.status).toBe(403);
  });

  it("rejects image fields until the image API is implemented", async () => {
    const response = await createApp({ tokenVerifier: adminVerifier }).request(
      "/api/v1/posts",
      jsonRequest("POST", { content: "x", images: ["https://file.vacu.top/file/test.png"] }),
      env,
    );
    expect(response.status).toBe(422);
  });

  it("creates, normalizes, updates, navigates, paginates and soft-deletes posts", async () => {
    const app = createApp({ tokenVerifier: adminVerifier });
    const firstResponse = await app.request(
      "/api/v1/posts",
      jsonRequest("POST", { content: "  第一条   🙂\n\nhttps://example.com  " }),
      env,
    );
    expect(firstResponse.status).toBe(201);
    const first = await firstResponse.json<{ id: string; content: string; images: string[] }>();
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
    const pageTwo = await pageTwoResponse.json<{ items: Array<{ id: string }> }>();
    expect(pageTwo.items[0]?.id).toBe(first.id);

    const detailResponse = await app.request(`/api/v1/posts/${first.id}`, {}, env);
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
    const updated = await updateResponse.json<{ content: string; edited: boolean }>();
    expect(updated).toMatchObject({ content: "更新 后", edited: true });

    const deleteResponse = await app.request(
      `/api/v1/posts/${first.id}`,
      jsonRequest("DELETE"),
      env,
    );
    expect(deleteResponse.status).toBe(204);

    const missingResponse = await app.request(`/api/v1/posts/${first.id}`, {}, env);
    expect(missingResponse.status).toBe(404);

    const stored = await env.DB.prepare("SELECT deleted_at FROM posts WHERE id = ?")
      .bind(first.id)
      .first<{ deleted_at: string | null }>();
    expect(stored?.deleted_at).not.toBeNull();
  });

  it("rejects invalid cursors and disallowed browser origins", async () => {
    const invalidCursor = await createApp().request("/api/v1/posts?cursor=bad", {}, env);
    expect(invalidCursor.status).toBe(400);

    const wrongOrigin = await createApp({ tokenVerifier: adminVerifier }).request(
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
