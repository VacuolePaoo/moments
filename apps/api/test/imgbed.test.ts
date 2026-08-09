import { describe, expect, it } from "vitest";

import {
  deleteImgBedImages,
  imgBedFileIdFromUrl,
  type ImgBedFetch,
} from "../src/services/imgbed";

const bindings = {
  CFBED_BASE_URL: "https://file.example.com",
  CFBED_API_TOKEN: "test-delete-token",
};

function parseJsonBody(init: RequestInit): unknown {
  if (typeof init.body !== "string") throw new Error("Expected a JSON body.");
  return JSON.parse(init.body) as unknown;
}

describe("CloudFlare ImgBed deletion", () => {
  it("extracts only managed file IDs", () => {
    const baseUrl = new URL("https://file.example.com");
    expect(
      imgBedFileIdFromUrl(
        "https://file.example.com/file/moments/hello%20world.png",
        baseUrl,
      ),
    ).toBe("moments/hello world.png");
    expect(
      imgBedFileIdFromUrl(
        "https://other.example.com/file/moments/image.png",
        baseUrl,
      ),
    ).toBeNull();
    expect(
      imgBedFileIdFromUrl("https://file.example.com/not-file/image.png", baseUrl),
    ).toBeNull();
  });

  it("uses one batch request for multiple managed images", async () => {
    const calls: Array<{ input: string; init: RequestInit }> = [];
    const fetcher: ImgBedFetch = (input, init) => {
      calls.push({ input, init });
      const body = parseJsonBody(init) as { fileIds: string[] };
      return Promise.resolve(
        Response.json({ success: true, deleted: body.fileIds, failed: [] }),
      );
    };
    const managedImages = Array.from(
      { length: 500 },
      (_, index) =>
        `https://file.example.com/file/moments/${String(index)}.png`,
    );

    await deleteImgBedImages(
      [
        ...managedImages,
        "https://file.example.com/file/moments/0.png",
        "https://other.example.com/file/not-managed.png",
      ],
      bindings,
      fetcher,
    );

    expect(calls).toHaveLength(1);
    expect(calls.every((call) => call.input.endsWith("/api/manage/delete/batch"))).toBe(
      true,
    );
    expect(calls[0]?.init.headers).toMatchObject({
      Authorization: "Bearer test-delete-token",
      "Content-Type": "application/json",
    });
    const firstBody = parseJsonBody(calls[0]?.init ?? {}) as {
      fileIds: string[];
    };
    expect(firstBody.fileIds).toHaveLength(500);
  });

  it("uses the single-file API for exactly one managed image", async () => {
    const calls: Array<{ input: string; init: RequestInit }> = [];
    const fetcher: ImgBedFetch = (input, init) => {
      calls.push({ input, init });
      return Promise.resolve(
        Response.json({
          success: true,
          fileId: "moments/hello world.png",
        }),
      );
    };

    await deleteImgBedImages(
      ["https://file.example.com/file/moments/hello%20world.png"],
      bindings,
      fetcher,
    );

    expect(calls).toEqual([
      {
        input:
          "https://file.example.com/api/manage/delete/moments/hello%20world.png",
        init: {
          method: "GET",
          headers: { Authorization: "Bearer test-delete-token" },
        },
      },
    ]);
  });

  it("uses the single-file API for a final one-item remainder", async () => {
    const calls: Array<{ input: string; init: RequestInit }> = [];
    const fetcher: ImgBedFetch = (input, init) => {
      calls.push({ input, init });
      if (input.endsWith("/api/manage/delete/batch")) {
        const body = parseJsonBody(init) as { fileIds: string[] };
        return Promise.resolve(
          Response.json({ success: true, deleted: body.fileIds, failed: [] }),
        );
      }
      return Promise.resolve(
        Response.json({ success: true, fileId: "moments/500.png" }),
      );
    };
    const images = Array.from(
      { length: 501 },
      (_, index) =>
        `https://file.example.com/file/moments/${String(index)}.png`,
    );

    await deleteImgBedImages(images, bindings, fetcher);

    expect(calls).toHaveLength(2);
    expect(calls[0]?.input).toBe(
      "https://file.example.com/api/manage/delete/batch",
    );
    expect(calls[1]?.input).toBe(
      "https://file.example.com/api/manage/delete/moments/500.png",
    );
  });

  it("falls back when ImgBed does not return a documented batch result", async () => {
    const calls: Array<{ input: string; init: RequestInit }> = [];
    const fetcher: ImgBedFetch = (input, init) => {
      calls.push({ input, init });
      if (!input.endsWith("/api/manage/delete/batch")) {
        const prefix = "https://file.example.com/api/manage/delete/";
        const fileId = decodeURIComponent(input.slice(prefix.length));
        return Promise.resolve(Response.json({ success: true, fileId }));
      }
      return Promise.resolve(
        Response.json({ success: true, fileId: "batch" }),
      );
    };

    await deleteImgBedImages(
      [
        "https://file.example.com/file/moments/hello%20world.png",
        "https://file.example.com/file/moments/avatar.jpg",
      ],
      bindings,
      fetcher,
    );

    expect(calls).toHaveLength(3);
    expect(calls[0]?.input).toBe(
      "https://file.example.com/api/manage/delete/batch",
    );
    expect(parseJsonBody(calls[0]?.init ?? {})).toEqual({
      fileIds: ["moments/hello world.png", "moments/avatar.jpg"],
    });
    expect(calls.slice(1).map((call) => call.input)).toEqual([
      "https://file.example.com/api/manage/delete/moments/hello%20world.png",
      "https://file.example.com/api/manage/delete/moments/avatar.jpg",
    ]);
  });

  it("retries only files reported as failed by a documented batch response", async () => {
    const calls: Array<{ input: string; init: RequestInit }> = [];
    const fetcher: ImgBedFetch = (input, init) => {
      calls.push({ input, init });
      if (input.endsWith("/api/manage/delete/batch")) {
        return Promise.resolve(
          Response.json({
            success: false,
            deleted: ["moments/one.png"],
            failed: [
              { fileId: "moments/two.png", error: "Delete file failed" },
            ],
          }),
        );
      }
      return Promise.resolve(
        Response.json({ success: true, fileId: "moments/two.png" }),
      );
    };

    await deleteImgBedImages(
      [
        "https://file.example.com/file/moments/one.png",
        "https://file.example.com/file/moments/two.png",
      ],
      bindings,
      fetcher,
    );

    expect(calls).toHaveLength(2);
    expect(calls[1]?.input).toBe(
      "https://file.example.com/api/manage/delete/moments/two.png",
    );
  });

  it("rejects an incomplete documented batch success response", async () => {
    const fetcher: ImgBedFetch = () =>
      Promise.resolve(
        Response.json({
          success: true,
          deleted: ["moments/one.png"],
          failed: [],
        }),
      );

    await expect(
      deleteImgBedImages(
        [
          "https://file.example.com/file/moments/one.png",
          "https://file.example.com/file/moments/two.png",
        ],
        bindings,
        fetcher,
      ),
    ).rejects.toMatchObject({ status: 502, code: "IMAGE_DELETE_FAILED" });
  });

  it("fails safely when ImgBed reports a partial deletion", async () => {
    const fetcher: ImgBedFetch = () =>
      Promise.resolve(
        Response.json({
          success: false,
          deleted: ["moments/one.png"],
          failed: [
            { fileId: "moments/two.png", error: "Delete file failed" },
          ],
        }),
      );

    await expect(
      deleteImgBedImages(
        ["https://file.example.com/file/moments/one.png"],
        bindings,
        fetcher,
      ),
    ).rejects.toMatchObject({ status: 502, code: "IMAGE_DELETE_FAILED" });
  });

  it("requires deletion settings only when a post has images", async () => {
    await expect(deleteImgBedImages([], {})).resolves.toBeUndefined();
    await expect(
      deleteImgBedImages(["https://file.example.com/file/image.png"], {}),
    ).rejects.toMatchObject({
      status: 503,
      code: "IMAGE_DELETE_NOT_CONFIGURED",
    });
  });
});
