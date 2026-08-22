import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { Context, MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";

import {
  assertAdministrator,
  administratorUserId,
  requireAdministrator,
  requireAdministratorForMethods,
  requireAuthentication,
  verifyClerkSession,
} from "./auth";
import {
  previewBackupRestore,
  restoreBackup,
} from "./db/backup";
import {
  assertPostImageAttached,
  clearAllPosts,
  createPost,
  getAllPostImages,
  getDateDetail,
  getDeletedPostImages,
  getPostDetail,
  getRandomDateDetail,
  listDeletedPosts,
  listAllPostsForBackup,
  listPosts,
  listPostsInWindow,
  permanentlyDeletePost,
  removePostImage,
  restorePost,
  softDeletePost,
  updatePost,
} from "./db/posts";
import {
  assertFeatureEnabled,
  getAppSettings,
  updateAppSettings,
} from "./db/settings";
import {
  getMomentStatistics,
  rebuildStatisticsAggregates,
} from "./db/statistics";
import { normalizeContent } from "./lib/content";
import { InvalidCursorError } from "./lib/cursor";
import { ApiError, errorBody, errorResponse } from "./lib/errors";
import { openApiConfig } from "./openapi";
import { deleteImgBedImages } from "./services/imgbed";
import {
  canonicalSiteOrigin,
  renderRss,
  rssWindowBounds,
} from "./services/rss";
import {
  AppSettingsSchema,
  AuthStatusSchema,
  ClearPostsResultSchema,
  ClearPostsSchema,
  CompleteBackupSchema,
  DeletePostImageSchema,
  DeletedPostListSchema,
  ErrorSchema,
  HealthSchema,
  MomentStatisticsSchema,
  PostDetailSchema,
  PostIdSchema,
  PostListSchema,
  PostSchema,
  RestoreBackupPreviewRequestSchema,
  RestoreBackupPreviewSchema,
  RestoreBackupRequestSchema,
  RestoreBackupResultSchema,
  ShanghaiDateSchema,
  UpdateSettingsSchema,
  WritePostSchema,
} from "./schemas";
import type { AppSettings } from "./schemas";
import type { AppEnv, ImageDeleter, TokenVerifier } from "./types";

const jsonContent = <T extends z.ZodType>(schema: T) => ({
  "application/json": { schema },
});

const rssContent = (schema: z.ZodString) => ({
  "application/rss+xml": { schema },
});

const errorResponseDefinition = (description: string) => ({
  description,
  content: jsonContent(ErrorSchema),
});

function normalizePostInput(input: { content: string; images: string[] }): {
  content: string;
  images: string[];
} {
  const content = normalizeContent(input.content);
  if (content.length === 0 && input.images.length === 0) {
    throw new ApiError(
      422,
      "EMPTY_POST",
      "Post text or at least one image is required.",
    );
  }
  return { content, images: input.images };
}

async function withCursorError<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof InvalidCursorError) {
      throw new ApiError(400, "INVALID_CURSOR", error.message);
    }
    throw error;
  }
}

async function assertContentAccess(
  c: Context<AppEnv>,
  settings: AppSettings,
  verifier: TokenVerifier,
): Promise<void> {
  if (settings.content.public) return;
  await assertAdministrator(c, verifier);
}

const securityHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set("requestId", crypto.randomUUID());
  await next();
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Request-Id", c.get("requestId"));
};

const corsAndOriginGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  const origin = c.req.header("Origin");
  const requestedMethod = c.req
    .header("Access-Control-Request-Method")
    ?.toUpperCase();
  const path = c.req.path;
  const isPrivateRead =
    path === "/api/v1/auth/me" ||
    path === "/api/v1/settings" ||
    path.startsWith("/api/v1/maintenance/") ||
    path.startsWith("/api/v1/statistics") ||
    path === "/api/v1/trash" ||
    path.startsWith("/api/v1/trash/");
  const isPublicRead = c.req.method === "GET" && !isPrivateRead;

  if (c.req.method === "OPTIONS") {
    const publicPreflight = requestedMethod === "GET" && !isPrivateRead;
    if (!publicPreflight && origin !== c.env.ALLOWED_ORIGIN) {
      throw new ApiError(
        403,
        "ORIGIN_NOT_ALLOWED",
        "The request origin is not allowed.",
      );
    }
    c.header(
      "Access-Control-Allow-Origin",
      publicPreflight ? "*" : c.env.ALLOWED_ORIGIN,
    );
    c.header(
      "Access-Control-Allow-Methods",
      "GET, POST, PATCH, DELETE, OPTIONS",
    );
    c.header("Access-Control-Allow-Headers", "Authorization, Content-Type");
    c.header("Access-Control-Max-Age", "86400");
    return c.body(null, 204);
  }

  if (
    !isPublicRead &&
    origin !== undefined &&
    origin !== c.env.ALLOWED_ORIGIN
  ) {
    throw new ApiError(
      403,
      "ORIGIN_NOT_ALLOWED",
      "The request origin is not allowed.",
    );
  }

  await next();
  if (isPublicRead) {
    c.header("Access-Control-Allow-Origin", "*");
  } else if (origin === c.env.ALLOWED_ORIGIN) {
    c.header("Access-Control-Allow-Origin", origin);
    c.header("Vary", "Origin");
  }
};

const listPostsRoute = createRoute({
  method: "get",
  path: "/api/v1/posts",
  operationId: "listPosts",
  tags: ["Posts"],
  summary: "List posts, or return every post of one Asia/Shanghai date",
  request: {
    query: z.object({
      limit: z.coerce.number().int().min(1).max(100).optional().openapi({
        description:
          "Page size. When omitted, the configured content page size is used.",
      }),
      cursor: z.string().min(1).optional(),
      anchorDate: ShanghaiDateSchema.optional().openapi({
        description:
          "Start at the end of this Asia/Shanghai date and page toward older posts. Mutually exclusive with cursor and date.",
      }),
      date: ShanghaiDateSchema.optional().openapi({
        description:
          "Return every post of this Asia/Shanghai date plus adjacent-date navigation, ignoring limit. Mutually exclusive with cursor and anchorDate.",
      }),
    }),
  },
  responses: {
    200: {
      description:
        "A newest-first cursor page, or a full day with navigation in date mode.",
      content: jsonContent(PostListSchema),
    },
    400: errorResponseDefinition("Invalid pagination cursor."),
    401: errorResponseDefinition("Content is not public."),
    403: errorResponseDefinition("Administrator access required."),
    404: errorResponseDefinition("The requested date has no posts."),
    422: errorResponseDefinition("Invalid query parameters."),
    500: errorResponseDefinition("Unexpected server error."),
  },
});

const getStatisticsRoute = createRoute({
  method: "get",
  path: "/api/v1/statistics",
  operationId: "getMomentStatistics",
  tags: ["Statistics"],
  summary: "Get daily post counts and a rendered administrator narrative",
  security: [{ ClerkBearer: [] }],
  responses: {
    200: {
      description:
        "Daily counts and a structured administrator narrative computed in Asia/Shanghai.",
      content: jsonContent(MomentStatisticsSchema),
    },
    401: errorResponseDefinition("Authentication required."),
    403: errorResponseDefinition("Administrator access required."),
    500: errorResponseDefinition("Unexpected server error."),
    503: errorResponseDefinition("Authentication is not configured."),
  },
});

const rebuildStatisticsRoute = createRoute({
  method: "post",
  path: "/api/v1/statistics/rebuild",
  operationId: "rebuildMomentStatistics",
  tags: ["Statistics"],
  summary: "Recompute statistics aggregates from the posts table",
  security: [{ ClerkBearer: [] }],
  responses: {
    200: {
      description: "Fresh statistics after the rebuild.",
      content: jsonContent(MomentStatisticsSchema),
    },
    401: errorResponseDefinition("Authentication required."),
    403: errorResponseDefinition("Administrator access required."),
    500: errorResponseDefinition("Unexpected server error."),
    503: errorResponseDefinition("Authentication is not configured."),
  },
});

const getRandomDateRoute = createRoute({
  method: "get",
  path: "/api/v1/random",
  operationId: "getRandomMomentDate",
  tags: ["Posts"],
  summary: "Pick a random post and return every post from its date",
  responses: {
    200: {
      description: "The randomly selected Asia/Shanghai date and its posts.",
      content: jsonContent(PostListSchema),
    },
    401: errorResponseDefinition("Content is not public."),
    403: errorResponseDefinition("The feature is disabled."),
    404: errorResponseDefinition("There are no posts to pick."),
    500: errorResponseDefinition("Unexpected server error."),
  },
});

const getRssRoute = createRoute({
  method: "get",
  path: "/rss.xml",
  operationId: "getRecentMomentsRss",
  tags: ["Posts"],
  summary: "Get an RSS 2.0 feed for the most recent 20 Shanghai calendar days",
  responses: {
    200: {
      description: "An RSS 2.0 XML document containing public posts.",
      content: rssContent(z.string()),
    },
    401: errorResponseDefinition("Content is not public."),
    403: errorResponseDefinition("The feature is disabled."),
    500: errorResponseDefinition("Unexpected server error."),
  },
});

const getPostRoute = createRoute({
  method: "get",
  path: "/api/v1/posts/{id}",
  operationId: "getPostById",
  tags: ["Posts"],
  summary: "Get a post and its adjacent post IDs",
  request: { params: z.object({ id: PostIdSchema }) },
  responses: {
    200: {
      description: "Post detail.",
      content: jsonContent(PostDetailSchema),
    },
    401: errorResponseDefinition("Content is not public."),
    403: errorResponseDefinition("Administrator access required."),
    404: errorResponseDefinition("Post not found."),
    422: errorResponseDefinition("Invalid post ID."),
    500: errorResponseDefinition("Unexpected server error."),
  },
});

const createPostRoute = createRoute({
  method: "post",
  path: "/api/v1/posts",
  operationId: "createPost",
  tags: ["Posts"],
  summary: "Create a post",
  security: [{ ClerkBearer: [] }],
  request: {
    body: { required: true, content: jsonContent(WritePostSchema) },
  },
  responses: {
    201: { description: "Post created.", content: jsonContent(PostSchema) },
    401: errorResponseDefinition("Authentication required."),
    403: errorResponseDefinition("Administrator access required."),
    422: errorResponseDefinition("Invalid request body."),
    500: errorResponseDefinition("Unexpected server error."),
    503: errorResponseDefinition("Authentication is not configured."),
  },
});

const updatePostRoute = createRoute({
  method: "patch",
  path: "/api/v1/posts/{id}",
  operationId: "updatePost",
  tags: ["Posts"],
  summary: "Update a post",
  security: [{ ClerkBearer: [] }],
  request: {
    params: z.object({ id: PostIdSchema }),
    body: { required: true, content: jsonContent(WritePostSchema) },
  },
  responses: {
    200: { description: "Post updated.", content: jsonContent(PostSchema) },
    401: errorResponseDefinition("Authentication required."),
    403: errorResponseDefinition("Administrator access required."),
    404: errorResponseDefinition("Post not found."),
    409: errorResponseDefinition(
      "Hosted images must be deleted through the post image endpoint.",
    ),
    422: errorResponseDefinition("Invalid request."),
    500: errorResponseDefinition("Unexpected server error."),
    503: errorResponseDefinition("Authentication is not configured."),
  },
});

const deletePostImageRoute = createRoute({
  method: "delete",
  path: "/api/v1/posts/{id}/images",
  operationId: "deletePostImage",
  tags: ["Posts"],
  summary: "Delete one hosted image and detach it from a post",
  security: [{ ClerkBearer: [] }],
  request: {
    params: z.object({ id: PostIdSchema }),
    body: { required: true, content: jsonContent(DeletePostImageSchema) },
  },
  responses: {
    200: {
      description: "Hosted image deleted and post image list updated.",
      content: jsonContent(PostSchema),
    },
    401: errorResponseDefinition("Authentication required."),
    403: errorResponseDefinition("Administrator access required."),
    404: errorResponseDefinition("Post or attached image not found."),
    422: errorResponseDefinition("Deleting the image would empty the post."),
    500: errorResponseDefinition("Unexpected server error."),
    502: errorResponseDefinition("Hosted image deletion failed."),
    503: errorResponseDefinition(
      "Authentication or hosted image deletion is not configured.",
    ),
  },
});

const deletePostRoute = createRoute({
  method: "delete",
  path: "/api/v1/posts/{id}",
  operationId: "deletePost",
  tags: ["Posts"],
  summary: "Soft-delete a post",
  security: [{ ClerkBearer: [] }],
  request: { params: z.object({ id: PostIdSchema }) },
  responses: {
    204: { description: "Post moved to the recycle bin." },
    401: errorResponseDefinition("Authentication required."),
    403: errorResponseDefinition("Administrator access required."),
    404: errorResponseDefinition("Post not found."),
    422: errorResponseDefinition("Invalid post ID."),
    500: errorResponseDefinition("Unexpected server error."),
    503: errorResponseDefinition("Authentication is not configured."),
  },
});

const restorePostRoute = createRoute({
  method: "post",
  path: "/api/v1/posts/{id}/restore",
  operationId: "restorePost",
  tags: ["Posts"],
  summary: "Restore a soft-deleted post",
  security: [{ ClerkBearer: [] }],
  request: { params: z.object({ id: PostIdSchema }) },
  responses: {
    200: { description: "Post restored.", content: jsonContent(PostSchema) },
    401: errorResponseDefinition("Authentication required."),
    403: errorResponseDefinition("Administrator access required."),
    404: errorResponseDefinition("Post not found."),
    409: errorResponseDefinition("Post is not deleted."),
    422: errorResponseDefinition("Invalid post ID."),
    500: errorResponseDefinition("Unexpected server error."),
    503: errorResponseDefinition("Authentication is not configured."),
  },
});

const listTrashRoute = createRoute({
  method: "get",
  path: "/api/v1/trash",
  operationId: "listDeletedPosts",
  tags: ["Trash"],
  summary: "List soft-deleted posts",
  security: [{ ClerkBearer: [] }],
  request: {
    query: z.object({
      limit: z.coerce.number().int().min(1).max(100).default(20),
      cursor: z.string().min(1).optional(),
    }),
  },
  responses: {
    200: {
      description: "A newest-deleted-first cursor page.",
      content: jsonContent(DeletedPostListSchema),
    },
    400: errorResponseDefinition("Invalid pagination cursor."),
    401: errorResponseDefinition("Authentication required."),
    403: errorResponseDefinition("Administrator access required."),
    422: errorResponseDefinition("Invalid query parameters."),
    500: errorResponseDefinition("Unexpected server error."),
    503: errorResponseDefinition("Authentication is not configured."),
  },
});

const permanentlyDeletePostRoute = createRoute({
  method: "delete",
  path: "/api/v1/trash/{id}",
  operationId: "permanentlyDeletePost",
  tags: ["Trash"],
  summary: "Permanently delete a post and its managed hosted images",
  security: [{ ClerkBearer: [] }],
  request: { params: z.object({ id: PostIdSchema }) },
  responses: {
    204: { description: "Hosted images and post permanently deleted." },
    401: errorResponseDefinition("Authentication required."),
    403: errorResponseDefinition("Administrator access required."),
    404: errorResponseDefinition("Post not found."),
    409: errorResponseDefinition("Post is not in the trash."),
    422: errorResponseDefinition("Invalid post ID."),
    502: errorResponseDefinition("Hosted image deletion failed."),
    500: errorResponseDefinition("Unexpected server error."),
    503: errorResponseDefinition(
      "Authentication or hosted image deletion is not configured.",
    ),
  },
});

const authStatusRoute = createRoute({
  method: "get",
  path: "/api/v1/auth/me",
  operationId: "getAuthStatus",
  tags: ["Authentication"],
  summary: "Get authenticated administrator status",
  security: [{ ClerkBearer: [] }],
  responses: {
    200: {
      description: "Authentication status.",
      content: jsonContent(AuthStatusSchema),
    },
    401: errorResponseDefinition("Authentication required."),
    500: errorResponseDefinition("Unexpected server error."),
    503: errorResponseDefinition("Authentication is not configured."),
  },
});

const MAX_RESTORE_BODY_SIZE = 16 * 1024 * 1024;

function assertConfiguredOrigin(c: Context<AppEnv>): void {
  if (c.req.header("Origin") === c.env.ALLOWED_ORIGIN) return;
  throw new ApiError(
    403,
    "ORIGIN_REQUIRED",
    "This operation is only allowed from the configured origin.",
  );
}

const getPublicSettingsRoute = createRoute({
  method: "get",
  path: "/api/v1/settings/public",
  operationId: "getPublicSettings",
  tags: ["Settings"],
  summary: "Get public site, feature and content settings",
  responses: {
    200: {
      description: "Current non-sensitive application settings.",
      content: jsonContent(AppSettingsSchema),
    },
    500: errorResponseDefinition("Unexpected server error."),
    503: errorResponseDefinition("Settings are not initialized."),
  },
});

const getSettingsRoute = createRoute({
  method: "get",
  path: "/api/v1/settings",
  operationId: "getSettings",
  tags: ["Settings"],
  summary: "Get administrator settings",
  security: [{ ClerkBearer: [] }],
  responses: {
    200: {
      description: "Current application settings.",
      content: jsonContent(AppSettingsSchema),
    },
    401: errorResponseDefinition("Authentication required."),
    403: errorResponseDefinition("Administrator access required."),
    500: errorResponseDefinition("Unexpected server error."),
    503: errorResponseDefinition("Settings or authentication are not configured."),
  },
});

const updateSettingsRoute = createRoute({
  method: "patch",
  path: "/api/v1/settings",
  operationId: "updateSettings",
  tags: ["Settings"],
  summary: "Update administrator settings",
  security: [{ ClerkBearer: [] }],
  request: {
    body: { required: true, content: jsonContent(UpdateSettingsSchema) },
  },
  responses: {
    200: {
      description: "Updated application settings.",
      content: jsonContent(AppSettingsSchema),
    },
    401: errorResponseDefinition("Authentication required."),
    403: errorResponseDefinition("Administrator access required."),
    422: errorResponseDefinition("Invalid settings."),
    500: errorResponseDefinition("Unexpected server error."),
    503: errorResponseDefinition("Settings or authentication are not configured."),
  },
});

const createBackupRoute = createRoute({
  method: "get",
  path: "/api/v1/maintenance/backup",
  operationId: "createCompleteBackup",
  tags: ["Maintenance"],
  summary: "Export a structured backup of all posts and settings",
  security: [{ ClerkBearer: [] }],
  responses: {
    200: {
      description: "Complete structured backup.",
      content: jsonContent(CompleteBackupSchema),
    },
    401: errorResponseDefinition("Authentication required."),
    403: errorResponseDefinition("Administrator access required."),
    500: errorResponseDefinition("Unexpected server error."),
    503: errorResponseDefinition("Settings or authentication are not configured."),
  },
});

const previewBackupRestoreRoute = createRoute({
  method: "post",
  path: "/api/v1/maintenance/restore/preview",
  operationId: "previewBackupRestore",
  tags: ["Maintenance"],
  summary: "Validate a backup and preview post ID conflicts",
  security: [{ ClerkBearer: [] }],
  request: {
    body: {
      required: true,
      content: jsonContent(RestoreBackupPreviewRequestSchema),
    },
  },
  responses: {
    200: {
      description: "Validated backup and current post ID conflicts.",
      content: jsonContent(RestoreBackupPreviewSchema),
    },
    401: errorResponseDefinition("Authentication required."),
    403: errorResponseDefinition(
      "Administrator access and the configured origin are required.",
    ),
    413: errorResponseDefinition("The backup payload is too large."),
    422: errorResponseDefinition("The backup is invalid or unsupported."),
    500: errorResponseDefinition("Unexpected server error."),
    503: errorResponseDefinition("Authentication is not configured."),
  },
});

const restoreBackupRoute = createRoute({
  method: "post",
  path: "/api/v1/maintenance/restore",
  operationId: "restoreBackup",
  tags: ["Maintenance"],
  summary: "Restore posts and settings from a structured backup",
  security: [{ ClerkBearer: [] }],
  request: {
    body: { required: true, content: jsonContent(RestoreBackupRequestSchema) },
  },
  responses: {
    200: {
      description: "Backup restored atomically, including derived data.",
      content: jsonContent(RestoreBackupResultSchema),
    },
    401: errorResponseDefinition("Authentication required."),
    403: errorResponseDefinition(
      "Administrator access and the configured origin are required.",
    ),
    409: errorResponseDefinition(
      "Existing post IDs conflict and overwrite was not confirmed.",
    ),
    413: errorResponseDefinition("The backup payload is too large."),
    422: errorResponseDefinition("The backup is invalid or unsupported."),
    500: errorResponseDefinition("Unexpected server error."),
    503: errorResponseDefinition("Settings or authentication are not configured."),
  },
});

const clearPostsRoute = createRoute({
  method: "post",
  path: "/api/v1/maintenance/clear-posts",
  operationId: "clearAllPosts",
  tags: ["Maintenance"],
  summary: "Permanently delete all posts and their managed images",
  security: [{ ClerkBearer: [] }],
  request: {
    body: { required: true, content: jsonContent(ClearPostsSchema) },
  },
  responses: {
    200: {
      description: "All hosted images and posts were permanently deleted.",
      content: jsonContent(ClearPostsResultSchema),
    },
    401: errorResponseDefinition("Authentication required."),
    403: errorResponseDefinition("Administrator access and the configured origin are required."),
    422: errorResponseDefinition("The confirmation phrase is invalid."),
    500: errorResponseDefinition("Unexpected server error."),
    502: errorResponseDefinition("Hosted image deletion failed."),
    503: errorResponseDefinition(
      "Authentication or hosted image deletion is not configured.",
    ),
  },
});

const healthRoute = createRoute({
  method: "get",
  path: "/health",
  operationId: "healthCheck",
  tags: ["System"],
  summary: "Check Worker and D1 health",
  responses: {
    200: {
      description: "The Worker can query D1.",
      content: jsonContent(HealthSchema),
    },
    500: errorResponseDefinition("D1 is unavailable."),
  },
});

export interface CreateAppOptions {
  tokenVerifier?: TokenVerifier;
  imageDeleter?: ImageDeleter;
}

export function createApp(options: CreateAppOptions = {}) {
  const tokenVerifier = options.tokenVerifier ?? verifyClerkSession;
  const imageDeleter = options.imageDeleter ?? deleteImgBedImages;
  const app = new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (result.success) return undefined;
      return errorResponse(
        c,
        422,
        "VALIDATION_ERROR",
        "The request is invalid.",
        result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      );
    },
  });

  app.use("*", securityHeaders);
  app.use("*", corsAndOriginGuard);

  const authenticate = requireAuthentication(tokenVerifier);
  const requireAdmin = requireAdministrator(tokenVerifier);
  app.use("/api/v1/auth/me", authenticate);
  app.use(
    "/api/v1/posts",
    requireAdministratorForMethods(tokenVerifier, ["POST"]),
  );
  app.use(
    "/api/v1/posts/*",
    requireAdministratorForMethods(tokenVerifier, ["PATCH", "DELETE", "POST"]),
  );
  app.use("/api/v1/trash", requireAdmin);
  app.use("/api/v1/trash/*", requireAdmin);
  app.use("/api/v1/statistics", requireAdmin);
  app.use("/api/v1/statistics/*", requireAdmin);
  app.use("/api/v1/settings", requireAdmin);
  app.use("/api/v1/maintenance/*", requireAdmin);
  const restoreBodyLimit = bodyLimit({
    maxSize: MAX_RESTORE_BODY_SIZE,
    onError: (c) =>
      c.json(
        errorBody(
          String(c.get("requestId")),
          "PAYLOAD_TOO_LARGE",
          "The backup payload is too large.",
        ),
        413,
      ),
  });
  app.use("/api/v1/maintenance/restore/preview", restoreBodyLimit);
  app.use("/api/v1/maintenance/restore", restoreBodyLimit);

  app.openapi(healthRoute, async (c) => {
    await c.env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
    return c.json(
      {
        status: "ok" as const,
        database: "ok" as const,
        fileOperationsConfigured:
          typeof c.env.CFBED_BASE_URL === "string" &&
          c.env.CFBED_BASE_URL.length > 0,
        timestamp: new Date().toISOString(),
      },
      200,
    );
  });

  app.openapi(listPostsRoute, async (c) => {
    const { limit, cursor, anchorDate, date } = c.req.valid("query");
    const settings = await getAppSettings(c.env.DB);
    await assertContentAccess(c, settings, tokenVerifier);
    if (
      [cursor, anchorDate, date].filter((value) => value !== undefined).length >
      1
    ) {
      throw new ApiError(
        422,
        "PAGINATION_CONFLICT",
        "cursor, anchorDate and date cannot be used together.",
      );
    }
    if (date !== undefined) {
      return c.json(
        { ...(await getDateDetail(c.env.DB, date)), nextCursor: null },
        200,
      );
    }
    return c.json(
      await withCursorError(() =>
        listPosts(
          c.env.DB,
          limit ?? settings.content.pageSize,
          cursor,
          anchorDate,
        ),
      ),
      200,
    );
  });

  app.openapi(getStatisticsRoute, async (c) => {
    const settings = await getAppSettings(c.env.DB);
    assertFeatureEnabled(settings.features.statistics, "statistics");
    return c.json(await getMomentStatistics(c.env.DB), 200);
  });

  app.openapi(rebuildStatisticsRoute, async (c) => {
    const settings = await getAppSettings(c.env.DB);
    assertFeatureEnabled(settings.features.statistics, "statistics");
    return c.json(await rebuildStatisticsAggregates(c.env.DB), 200);
  });

  app.openapi(getRandomDateRoute, async (c) => {
    const settings = await getAppSettings(c.env.DB);
    assertFeatureEnabled(settings.features.random, "random");
    await assertContentAccess(c, settings, tokenVerifier);
    return c.json(
      { ...(await getRandomDateDetail(c.env.DB)), nextCursor: null },
      200,
    );
  });

  app.openapi(getRssRoute, async (c) => {
    const settings = await getAppSettings(c.env.DB);
    assertFeatureEnabled(settings.features.rss, "rss");
    await assertContentAccess(c, settings, tokenVerifier);
    const now = new Date();
    const { startAt, endAt } = rssWindowBounds(now);
    const posts = await listPostsInWindow(c.env.DB, startAt, endAt);
    const siteOrigin = canonicalSiteOrigin(c.env.ALLOWED_ORIGIN, c.req.url);
    return c.body(renderRss(posts, siteOrigin, now, settings.site), 200, {
      "Content-Type": "application/rss+xml; charset=utf-8",
    });
  });

  app.openapi(getPostRoute, async (c) => {
    const settings = await getAppSettings(c.env.DB);
    await assertContentAccess(c, settings, tokenVerifier);
    return c.json(await getPostDetail(c.env.DB, c.req.valid("param").id), 200);
  });

  app.openapi(createPostRoute, async (c) => {
    const input = normalizePostInput(c.req.valid("json"));
    return c.json(await createPost(c.env.DB, input.content, input.images), 201);
  });

  app.openapi(updatePostRoute, async (c) => {
    const { id } = c.req.valid("param");
    const input = normalizePostInput(c.req.valid("json"));
    return c.json(
      await updatePost(c.env.DB, id, input.content, input.images),
      200,
    );
  });

  app.openapi(deletePostImageRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { imageUrl } = c.req.valid("json");
    await assertPostImageAttached(c.env.DB, id, imageUrl);
    await imageDeleter([imageUrl], c.env);
    return c.json(await removePostImage(c.env.DB, id, imageUrl), 200);
  });

  app.openapi(deletePostRoute, async (c) => {
    await softDeletePost(c.env.DB, c.req.valid("param").id);
    return c.body(null, 204);
  });

  app.openapi(restorePostRoute, async (c) => {
    return c.json(await restorePost(c.env.DB, c.req.valid("param").id), 200);
  });

  app.openapi(listTrashRoute, async (c) => {
    const { limit, cursor } = c.req.valid("query");
    return c.json(
      await withCursorError(() => listDeletedPosts(c.env.DB, limit, cursor)),
      200,
    );
  });

  app.openapi(permanentlyDeletePostRoute, async (c) => {
    const { id } = c.req.valid("param");
    const images = await getDeletedPostImages(c.env.DB, id);
    await imageDeleter(images, c.env);
    await permanentlyDeletePost(c.env.DB, id);
    return c.body(null, 204);
  });

  app.openapi(authStatusRoute, (c) => {
    const adminUserId = administratorUserId(c.env);
    return c.json(
      {
        authenticated: true as const,
        isAdmin: c.get("authenticatedUserId") === adminUserId,
      },
      200,
    );
  });

  app.openapi(getPublicSettingsRoute, async (c) => {
    return c.json(await getAppSettings(c.env.DB), 200);
  });

  app.openapi(getSettingsRoute, async (c) => {
    return c.json(await getAppSettings(c.env.DB), 200);
  });

  app.openapi(updateSettingsRoute, async (c) => {
    const current = await getAppSettings(c.env.DB);
    const updated = await updateAppSettings(c.env.DB, c.req.valid("json"));
    if (
      !current.features.statistics &&
      updated.features.statistics
    ) {
      await rebuildStatisticsAggregates(c.env.DB);
    }
    return c.json(updated, 200);
  });

  app.openapi(createBackupRoute, async (c) => {
    const [settings, posts] = await Promise.all([
      getAppSettings(c.env.DB),
      listAllPostsForBackup(c.env.DB),
    ]);
    return c.json(
      {
        version: 1 as const,
        exportedAt: new Date().toISOString(),
        settings,
        posts,
      },
      200,
    );
  });

  app.openapi(previewBackupRestoreRoute, async (c) => {
    assertConfiguredOrigin(c);
    return c.json(
      await previewBackupRestore(c.env.DB, c.req.valid("json").backup),
      200,
    );
  });

  app.openapi(restoreBackupRoute, async (c) => {
    assertConfiguredOrigin(c);
    const { backup, overwriteConflicts } = c.req.valid("json");
    return c.json(
      await restoreBackup(c.env.DB, backup, overwriteConflicts),
      200,
    );
  });

  app.openapi(clearPostsRoute, async (c) => {
    assertConfiguredOrigin(c);

    c.req.valid("json");
    const images = await getAllPostImages(c.env.DB);
    for (let index = 0; index < images.length; index += 500) {
      await imageDeleter(images.slice(index, index + 500), c.env);
    }
    const deletedPosts = await clearAllPosts(c.env.DB);
    return c.json(
      { deletedPosts, deletedImages: images.length },
      200,
    );
  });

  app.openAPIRegistry.registerComponent("securitySchemes", "ClerkBearer", {
    type: "http",
    scheme: "bearer",
    bearerFormat: "Clerk session JWT",
    description: "Clerk session token returned by getToken().",
  });

  app.doc31("/openapi.json", openApiConfig);

  app.notFound((c) =>
    errorResponse(
      c,
      404,
      "NOT_FOUND",
      "The requested endpoint does not exist.",
    ),
  );

  app.onError((error, c) => {
    if (error instanceof ApiError) {
      return errorResponse(
        c,
        error.status,
        error.code,
        error.message,
        error.details,
      );
    }

    console.error(
      JSON.stringify({
        message: "Unhandled request error",
        error: error instanceof Error ? error.message : String(error),
        path: c.req.path,
        requestId: c.get("requestId"),
      }),
    );
    return c.json(
      errorBody(
        c.get("requestId"),
        "INTERNAL_ERROR",
        "An unexpected error occurred.",
      ),
      500,
    );
  });

  return app;
}
