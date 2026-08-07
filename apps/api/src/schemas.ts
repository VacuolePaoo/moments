import { z } from "@hono/zod-openapi";

import { isValidShanghaiDate } from "./lib/date";

export const PostIdSchema = z.uuid().openapi({
  description: "Stable post ID.",
  example: "b3d4da0e-9d8d-43ee-a6a2-c0139814d59e",
});

export const PostSchema = z
  .object({
    id: PostIdSchema,
    content: z.string().openapi({ example: "今天完成了 Moments API。" }),
    images: z.array(z.url()).openapi({
      description:
        "Reserved for the later image-hosting integration. Empty in the first release.",
      example: [],
    }),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
    edited: z.boolean(),
  })
  .openapi("Post");

export type Post = z.infer<typeof PostSchema>;

export const PostListSchema = z
  .object({
    items: z.array(PostSchema),
    nextCursor: z.string().nullable(),
  })
  .openapi("PostList");

export type PostList = z.infer<typeof PostListSchema>;

export const ShanghaiDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isValidShanghaiDate, "Invalid Asia/Shanghai calendar date.")
  .openapi({
    description: "Calendar date in the fixed Asia/Shanghai time zone.",
    example: "2026-08-07",
  });

export const PostDetailSchema = z
  .object({
    post: PostSchema,
    navigation: z.object({
      newerId: PostIdSchema.nullable(),
      olderId: PostIdSchema.nullable(),
    }),
  })
  .openapi("PostDetail");

export const DateDetailSchema = z
  .object({
    date: ShanghaiDateSchema,
    items: z.array(PostSchema),
    navigation: z.object({
      newerDate: ShanghaiDateSchema.nullable(),
      olderDate: ShanghaiDateSchema.nullable(),
    }),
  })
  .openapi("DateDetail");

export type DateDetail = z.infer<typeof DateDetailSchema>;

export const WritePostSchema = z
  .strictObject({
    content: z.string().min(1).openapi({
      description:
        "Plain text. Consecutive spaces, tabs and line breaks are normalized before storage.",
    }),
  })
  .openapi("WritePost");

export const ErrorDetailSchema = z.object({
  path: z.string(),
  message: z.string(),
});

export const ErrorSchema = z
  .object({
    error: z.object({
      code: z.string(),
      message: z.string(),
      details: z.array(ErrorDetailSchema).optional(),
    }),
    requestId: z.uuid(),
  })
  .openapi("Error");

export const HealthSchema = z
  .object({
    status: z.literal("ok"),
    database: z.literal("ok"),
    timestamp: z.iso.datetime({ offset: true }),
  })
  .openapi("Health");

export const AuthStatusSchema = z
  .object({
    authenticated: z.literal(true),
    isAdmin: z.boolean(),
  })
  .openapi("AuthStatus");
