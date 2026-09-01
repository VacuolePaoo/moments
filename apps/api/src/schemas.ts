import { z } from "@hono/zod-openapi";

import { isValidShanghaiDate } from "./lib/date";

export const PostIdSchema = z.uuid().openapi({
  description: "Stable post ID.",
  example: "b3d4da0e-9d8d-43ee-a6a2-c0139814d59e",
});

const AudioMetadataSchema = z
  .strictObject({
    url: z.url().max(2_048),
    durationMs: z.number().int().min(1).max(1_800_000),
    mimeType: z.string().startsWith("audio/").max(100),
    sizeBytes: z.number().int().min(1).max(33_554_432),
  })
  .openapi("AudioMetadata");

function validatePostKind(
  post: {
    kind: "article" | "audio";
    content: string;
    images: string[];
    audio: z.infer<typeof AudioMetadataSchema> | null;
  },
  context: z.RefinementCtx,
): void {
  const valid =
    post.kind === "article"
      ? post.audio === null
      : post.content.length === 0 && post.audio !== null;
  if (!valid) {
    context.addIssue({
      code: "custom",
      message: "Article text and audio metadata cannot be mixed.",
      path: ["kind"],
    });
  }
}

export const PostSchema = z
  .object({
    id: PostIdSchema,
    kind: z.enum(["article", "audio"]),
    content: z.string().openapi({ example: "今天完成了 Moments API。" }),
    images: z.array(z.url()).openapi({
      description: "Ordered image URLs attached to this post.",
      example: ["https://file.example.com/file/example.jpg"],
    }),
    audio: AudioMetadataSchema.nullable(),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
    edited: z.boolean(),
  })
  .superRefine(validatePostKind)
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

const DeletedPostSchema = PostSchema.safeExtend({
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
    name: z.string().trim().max(80).default("Moments"),
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

export const WeekdayLanguageSchema = z
  .enum(["zh", "en", "ja"])
  .openapi({ description: "Display language used for weekday names." });

export type WeekdayLanguage = z.infer<typeof WeekdayLanguageSchema>;

const FormatSettingsSchema = z
  .strictObject({
    // Backups created before the weekday language switch existed omit this
    // field; the default keeps them restorable.
    weekdayLanguage: WeekdayLanguageSchema.default("zh"),
  })
  .openapi("FormatSettings");

const ContentSettingsSchema = z
  .strictObject({
    public: z.boolean(),
    // Backups created before the voice publishing switch existed omit this
    // field; the default keeps them restorable.
    voice: z.boolean().default(true),
    pageSize: z.number().int().min(1).max(100),
    // Backups created before the share page toolbar switch existed omit this
    // field; the default keeps them restorable.
    shareToolbar: z.boolean().default(true),
  })
  .openapi("ContentSettings");

export const AppSettingsSchema = z
  .strictObject({
    site: SiteSettingsSchema,
    features: FeatureSettingsSchema,
    content: ContentSettingsSchema,
    // Backups created before the date format group existed omit it; the default
    // keeps them restorable.
    format: FormatSettingsSchema.default({ weekdayLanguage: "zh" }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .openapi("AppSettings");

export type AppSettings = z.infer<typeof AppSettingsSchema>;

export const UpdateSettingsSchema = z
  .strictObject({
    // Keep PATCH fields free of response defaults. Zod applies defaults inside
    // partial objects, which would otherwise reset omitted site fields.
    site: z
      .strictObject({
        showName: z.boolean().optional(),
        name: z.string().trim().max(80).optional(),
        description: z.string().trim().max(280).optional(),
      })
      .optional(),
    features: FeatureSettingsSchema.partial().optional(),
    content: z
      .strictObject({
        public: z.boolean().optional(),
        voice: z.boolean().optional(),
        pageSize: z.number().int().min(1).max(100).optional(),
        shareToolbar: z.boolean().optional(),
      })
      .optional(),
    format: z
      .strictObject({
        weekdayLanguage: WeekdayLanguageSchema.optional(),
      })
      .optional(),
  })
  .refine(
    (value) =>
      value.site !== undefined ||
      value.features !== undefined ||
      value.content !== undefined ||
      value.format !== undefined,
    { message: "At least one settings group is required." },
  )
  .openapi("UpdateSettings");

export type UpdateSettings = z.infer<typeof UpdateSettingsSchema>;

const BackupPostSchema = z
  .strictObject({
    id: PostIdSchema,
    kind: z.enum(["article", "audio"]).default("article"),
    content: z.string().max(1_000_000),
    images: z.array(z.url().max(2_048)).max(18),
    audio: AudioMetadataSchema.nullable().default(null),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
    edited: z.boolean(),
    deletedAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .superRefine((post, context) => {
    validatePostKind(post, context);
    if (post.edited !== (post.updatedAt !== post.createdAt)) {
      context.addIssue({
        code: "custom",
        message: "edited must match whether updatedAt differs from createdAt.",
        path: ["edited"],
      });
    }
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
    deletedFiles: z.number().int().nonnegative(),
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

const CreateAudioPostSchema = z
  .strictObject({
    kind: z.literal("audio"),
    content: z.literal("").default(""),
    images: z.array(z.url()).max(18).default([]).openapi({
      description:
        "Ordered image URLs attached to this audio moment, at most 18.",
    }),
    audio: AudioMetadataSchema,
  })
  .openapi("CreateAudioPost");

const CreateArticlePostSchema = WritePostSchema.safeExtend({
  kind: z.literal("article").default("article"),
}).openapi("CreateArticlePost");

export const CreatePostSchema = z
  .union([CreateArticlePostSchema, CreateAudioPostSchema])
  .openapi("CreatePost");

export type CreatePostInput = z.infer<typeof CreatePostSchema>;

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
