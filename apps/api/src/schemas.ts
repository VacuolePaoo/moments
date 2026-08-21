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
      description: "Ordered image URLs attached to this post.",
      example: ["https://file.example.com/file/example.jpg"],
    }),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
    edited: z.boolean(),
  })
  .openapi("Post");

export type Post = z.infer<typeof PostSchema>;

export const ShanghaiDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isValidShanghaiDate, "Invalid Asia/Shanghai calendar date.")
  .openapi({
    description: "Calendar date in the fixed Asia/Shanghai time zone.",
    example: "2026-08-07",
  });

export const PostListSchema = z
  .object({
    items: z.array(PostSchema),
    nextCursor: z.string().nullable(),
    date: ShanghaiDateSchema.optional().openapi({
      description:
        "Present only in date mode (?date=...): the requested Asia/Shanghai date.",
    }),
    navigation: z
      .object({
        newerDate: ShanghaiDateSchema.nullable(),
        olderDate: ShanghaiDateSchema.nullable(),
      })
      .optional()
      .openapi({
        description:
          "Present only in date mode (?date=...): adjacent dates that have posts.",
      }),
  })
  .openapi("PostList");

export type PostList = z.infer<typeof PostListSchema>;

const DeletedPostSchema = PostSchema.extend({
  deletedAt: z.iso.datetime({ offset: true }),
}).openapi("DeletedPost");

export type DeletedPost = z.infer<typeof DeletedPostSchema>;

export const DeletedPostListSchema = z
  .object({
    items: z.array(DeletedPostSchema),
    nextCursor: z.string().nullable(),
  })
  .openapi("DeletedPostList");

export type DeletedPostList = z.infer<typeof DeletedPostListSchema>;

export const PostDetailSchema = z
  .object({
    post: PostSchema,
    navigation: z.object({
      newerId: PostIdSchema.nullable(),
      olderId: PostIdSchema.nullable(),
    }),
  })
  .openapi("PostDetail");

export type PostDetail = z.infer<typeof PostDetailSchema>;

const DailyMomentCountSchema = z
  .object({
    date: ShanghaiDateSchema,
    count: z.number().int().nonnegative(),
  })
  .openapi("DailyMomentCount");

const NarrativeSegmentSchema = z
  .object({
    text: z.string(),
    bold: z.boolean().default(false),
  })
  .openapi("NarrativeSegment");

const NarrativeParagraphSchema = z
  .object({
    segments: z.array(NarrativeSegmentSchema).min(1),
  })
  .openapi("NarrativeParagraph");

export const MomentStatisticsSchema = z
  .object({
    days: z.array(DailyMomentCountSchema),
    administratorNarrative: z.array(NarrativeParagraphSchema),
  })
  .openapi("MomentStatistics");

export type MomentStatistics = z.infer<typeof MomentStatisticsSchema>;

export const WritePostSchema = z
  .strictObject({
    content: z.string().default("").openapi({
      description:
        "Plain text. Consecutive spaces, tabs and line breaks are normalized before storage.",
    }),
    images: z.array(z.url()).max(18).default([]).openapi({
      description:
        "Ordered image URLs, at most 18. Text or at least one image is required.",
    }),
  })
  .refine(
    ({ content, images }) => content.trim().length > 0 || images.length > 0,
    { message: "Text or at least one image is required." },
  )
  .openapi("WritePost");

export const DeletePostImageSchema = z
  .strictObject({
    imageUrl: z.url().openapi({
      description: "Exact URL of the hosted image to delete from this post.",
      example: "https://file.example.com/file/moments/example.jpg",
    }),
  })
  .openapi("DeletePostImage");

const ErrorDetailSchema = z.object({
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
