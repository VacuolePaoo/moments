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

const SiteSettingsSchema = z
  .strictObject({
    showName: z.boolean(),
    name: z.string().trim().min(1).max(80).default("Moments"),
    description: z.string().trim().max(280).default(""),
  })
  .openapi("SiteSettings");

const FeatureSettingsSchema = z
  .strictObject({
    statistics: z.boolean(),
    random: z.boolean(),
    rss: z.boolean(),
  })
  .openapi("FeatureSettings");

const ContentSettingsSchema = z
  .strictObject({
    public: z.boolean(),
    pageSize: z.number().int().min(1).max(100),
  })
  .openapi("ContentSettings");

export const AppSettingsSchema = z
  .strictObject({
    site: SiteSettingsSchema,
    features: FeatureSettingsSchema,
    content: ContentSettingsSchema,
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .openapi("AppSettings");

export type AppSettings = z.infer<typeof AppSettingsSchema>;

export const UpdateSettingsSchema = z
  .strictObject({
    site: SiteSettingsSchema.partial().optional(),
    features: FeatureSettingsSchema.partial().optional(),
    content: ContentSettingsSchema.partial().optional(),
  })
  .refine(
    (value) =>
      value.site !== undefined ||
      value.features !== undefined ||
      value.content !== undefined,
    { message: "At least one settings group is required." },
  )
  .openapi("UpdateSettings");

export type UpdateSettings = z.infer<typeof UpdateSettingsSchema>;

const BackupPostSchema = z
  .strictObject({
    id: PostIdSchema,
    content: z.string().max(1_000_000),
    images: z.array(z.url().max(2_048)).max(18),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
    edited: z.boolean(),
    deletedAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .refine(({ createdAt, updatedAt, edited }) => edited === (updatedAt !== createdAt), {
    message: "edited must match whether updatedAt differs from createdAt.",
    path: ["edited"],
  })
  .openapi("BackupPost");

export const CompleteBackupSchema = z
  .strictObject({
    version: z.literal(1),
    exportedAt: z.iso.datetime({ offset: true }),
    settings: AppSettingsSchema,
    posts: z.array(BackupPostSchema),
  })
  .superRefine(({ posts }, context) => {
    const seen = new Set<string>();
    posts.forEach((post, index) => {
      if (!seen.has(post.id)) {
        seen.add(post.id);
        return;
      }
      context.addIssue({
        code: "custom",
        message: "Backup post IDs must be unique.",
        path: ["posts", index, "id"],
      });
    });
  })
  .openapi("CompleteBackup");

export type CompleteBackup = z.infer<typeof CompleteBackupSchema>;

export const RestoreBackupPreviewRequestSchema = z
  .strictObject({ backup: CompleteBackupSchema })
  .openapi("RestoreBackupPreviewRequest");

export const RestoreBackupPreviewSchema = z
  .strictObject({
    totalPosts: z.number().int().nonnegative(),
    conflictCount: z.number().int().nonnegative(),
    conflictIds: z.array(PostIdSchema),
    settingsWillBeRestored: z.literal(true),
  })
  .openapi("RestoreBackupPreview");

export const RestoreBackupRequestSchema = z
  .strictObject({
    backup: CompleteBackupSchema,
    overwriteConflicts: z.boolean().default(false),
  })
  .openapi("RestoreBackupRequest");

export const RestoreBackupResultSchema = z
  .strictObject({
    restoredPosts: z.number().int().nonnegative(),
    insertedPosts: z.number().int().nonnegative(),
    overwrittenPosts: z.number().int().nonnegative(),
    settings: AppSettingsSchema,
  })
  .openapi("RestoreBackupResult");

export type RestoreBackupResult = z.infer<typeof RestoreBackupResultSchema>;

export const ClearPostsSchema = z
  .strictObject({
    confirmation: z.literal("确认清空全部说说"),
  })
  .openapi("ClearPosts");

export const ClearPostsResultSchema = z
  .strictObject({
    deletedPosts: z.number().int().nonnegative(),
    deletedImages: z.number().int().nonnegative(),
  })
  .openapi("ClearPostsResult");

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
    fileOperationsConfigured: z.boolean(),
    timestamp: z.iso.datetime({ offset: true }),
  })
  .openapi("Health");

export const AuthStatusSchema = z
  .object({
    authenticated: z.literal(true),
    isAdmin: z.boolean(),
  })
  .openapi("AuthStatus");
