import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";

import {
  requireAdministratorForMethods,
  requireAuthentication,
  verifyClerkSession,
} from "./auth";
import {
  createPost,
  getDateDetail,
  getDeletedPost,
  getPost,
  getPostNavigation,
  listDeletedPosts,
  listPosts,
  permanentlyDeletePost,
  restorePost,
  softDeletePost,
  updatePost,
} from "./db/posts";
import { normalizeContent } from "./lib/content";
import { ApiError, errorBody, errorResponse } from "./lib/errors";
import { openApiConfig } from "./openapi";
import { deleteImgBedImages } from "./services/imgbed";
import {
  AuthStatusSchema,
  DateDetailSchema,
  DeletedPostListSchema,
  ErrorSchema,
  HealthSchema,
  PostDetailSchema,
  PostIdSchema,
  PostListSchema,
  PostSchema,
  ShanghaiDateSchema,
  WritePostSchema,
} from "./schemas";
import type { AppEnv, ImageDeleter, TokenVerifier } from "./types";

const jsonContent = <T extends z.ZodType>(schema: T) => ({
  "application/json": { schema },
});

const errorResponseDefinition = (description: string) => ({
  description,
  content: jsonContent(ErrorSchema),
});

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
    path === "/api/v1/auth/me" || path.startsWith("/api/v1/trash");
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
  summary: "List posts",
  request: {
    query: z.object({
      limit: z.coerce.number().int().min(1).max(100).default(20),
      cursor: z.string().min(1).optional(),
      anchorDate: ShanghaiDateSchema.optional().openapi({
        description:
          "Start at the end of this Asia/Shanghai date and page toward older posts. Mutually exclusive with cursor.",
      }),
    }),
  },
  responses: {
    200: {
      description: "A newest-first cursor page.",
      content: jsonContent(PostListSchema),
    },
    400: errorResponseDefinition("Invalid pagination cursor."),
    422: errorResponseDefinition("Invalid query parameters."),
    500: errorResponseDefinition("Unexpected server error."),
  },
});

const getDateRoute = createRoute({
  method: "get",
  path: "/api/v1/dates/{date}",
  operationId: "getDateDetail",
  tags: ["Dates"],
  summary:
    "Get all posts and adjacent dates for an Asia/Shanghai calendar date",
  request: { params: z.object({ date: ShanghaiDateSchema }) },
  responses: {
    200: {
      description: "Date detail and navigation.",
      content: jsonContent(DateDetailSchema),
    },
    404: errorResponseDefinition("The requested date has no posts."),
    422: errorResponseDefinition("Invalid calendar date."),
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
    422: errorResponseDefinition("Invalid request."),
    500: errorResponseDefinition("Unexpected server error."),
    503: errorResponseDefinition("Authentication is not configured."),
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
  app.use("/api/v1/auth/me", authenticate);
  app.use(
    "/api/v1/posts",
    requireAdministratorForMethods(tokenVerifier, ["POST"]),
  );
  app.use(
    "/api/v1/posts/*",
    requireAdministratorForMethods(tokenVerifier, ["PATCH", "DELETE", "POST"]),
  );
  app.use(
    "/api/v1/trash",
    requireAdministratorForMethods(tokenVerifier, ["GET"]),
  );
  app.use(
    "/api/v1/trash/*",
    requireAdministratorForMethods(tokenVerifier, ["DELETE"]),
  );

  app.openapi(healthRoute, async (c) => {
    await c.env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
    return c.json(
      {
        status: "ok" as const,
        database: "ok" as const,
        timestamp: new Date().toISOString(),
      },
      200,
    );
  });

  app.openapi(listPostsRoute, async (c) => {
    const { limit, cursor, anchorDate } = c.req.valid("query");
    if (cursor !== undefined && anchorDate !== undefined) {
      throw new ApiError(
        422,
        "PAGINATION_CONFLICT",
        "cursor and anchorDate cannot be used together.",
      );
    }
    try {
      return c.json(await listPosts(c.env.DB, limit, cursor, anchorDate), 200);
    } catch (error) {
      if (error instanceof Error && error.name === "InvalidCursorError") {
        throw new ApiError(400, "INVALID_CURSOR", error.message);
      }
      throw error;
    }
  });

  app.openapi(getDateRoute, async (c) => {
    return c.json(
      await getDateDetail(c.env.DB, c.req.valid("param").date),
      200,
    );
  });

  app.openapi(getPostRoute, async (c) => {
    const { id } = c.req.valid("param");
    const post = await getPost(c.env.DB, id);
    const navigation = await getPostNavigation(c.env.DB, post);
    return c.json({ post, navigation }, 200);
  });

  app.openapi(createPostRoute, async (c) => {
    const input = c.req.valid("json");
    const content = normalizeContent(input.content);
    if (content.length === 0 && input.images.length === 0) {
      throw new ApiError(
        422,
        "EMPTY_POST",
        "Post text or at least one image is required.",
      );
    }
    return c.json(await createPost(c.env.DB, content, input.images), 201);
  });

  app.openapi(updatePostRoute, async (c) => {
    const { id } = c.req.valid("param");
    const input = c.req.valid("json");
    const content = normalizeContent(input.content);
    if (content.length === 0 && input.images.length === 0) {
      throw new ApiError(
        422,
        "EMPTY_POST",
        "Post text or at least one image is required.",
      );
    }
    return c.json(await updatePost(c.env.DB, id, content, input.images), 200);
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
    try {
      return c.json(await listDeletedPosts(c.env.DB, limit, cursor), 200);
    } catch (error) {
      if (error instanceof Error && error.name === "InvalidCursorError") {
        throw new ApiError(400, "INVALID_CURSOR", error.message);
      }
      throw error;
    }
  });

  app.openapi(permanentlyDeletePostRoute, async (c) => {
    const { id } = c.req.valid("param");
    const post = await getDeletedPost(c.env.DB, id);
    await imageDeleter(post.images, c.env);
    await permanentlyDeletePost(c.env.DB, id);
    return c.body(null, 204);
  });

  app.openapi(authStatusRoute, (c) => {
    if (
      typeof c.env.ADMIN_CLERK_USER_ID !== "string" ||
      c.env.ADMIN_CLERK_USER_ID.length === 0
    ) {
      throw new ApiError(
        503,
        "AUTH_NOT_CONFIGURED",
        "Administrator access is not configured.",
      );
    }
    return c.json(
      {
        authenticated: true as const,
        isAdmin: c.get("authenticatedUserId") === c.env.ADMIN_CLERK_USER_ID,
      },
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
