type JsonObject = { [key: string]: JsonValue };
type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];

const translations: Readonly<Record<string, string>> = {
  "Moments API": "Moments API（中文）",
  "Public read and Clerk-protected write API for a personal Moments site. v2 merges date reads into GET /posts (?date=) and serves statistics from incremental aggregates.":
    "Moments 个人内容站点 API：公开读取，写操作由 Clerk 管理员鉴权保护。v2 将日期读取合并进 GET /posts（?date=），统计改由增量聚合表提供。",
  System: "系统",
  Posts: "内容",
  Statistics: "统计",
  Trash: "回收站",
  Authentication: "身份认证",
  "Service metadata and health.": "服务元数据与健康状态。",
  "Public post reads (feed, date mode, random) and administrator mutations.":
    "公开读取内容（信息流、日期模式、随机回顾），以及管理员创建、编辑和删除内容。",
  "Aggregated posting statistics and administrator maintenance.":
    "发布统计聚合数据与管理员维护操作。",
  "Administrator recycle bin management.": "管理员回收站管理。",
  "Clerk session and administrator status.": "Clerk 会话与管理员状态。",
  "Clerk session JWT": "Clerk 会话 JWT",
  "Clerk session token returned by getToken().":
    "Clerk getToken() 返回的会话令牌。请在请求头中填写 Authorization: Bearer <token>。",
  "Stable post ID.": "稳定的内容 UUID。",
  "Ordered image URLs attached to this post.": "内容所附的有序图片 URL 列表。",
  "Calendar date in the fixed Asia/Shanghai time zone.":
    "固定亚洲/上海时区的日历日期，格式为 YYYY-MM-DD。",
  "Plain text. Consecutive spaces, tabs and line breaks are normalized before storage.":
    "纯文本。保存前会规范化连续空格、制表符和换行。",
  "Ordered image URLs, at most 18. Text or at least one image is required.":
    "有序图片 URL 列表，最多 18 张。正文和图片至少提供一项。",
  "Exact URL of the hosted image to delete from this post.":
    "要从该内容中删除的托管图片完整 URL。",
  "Start at the end of this Asia/Shanghai date and page toward older posts. Mutually exclusive with cursor and date.":
    "从该亚洲/上海日期的末尾开始向更早内容分页；不能与 cursor 或 date 同时使用。",
  "Return every post of this Asia/Shanghai date plus adjacent-date navigation, ignoring limit. Mutually exclusive with cursor and anchorDate.":
    "返回该亚洲/上海日期下的全部内容及相邻日期导航，忽略 limit；不能与 cursor 或 anchorDate 同时使用。",
  "Check Worker and D1 health": "检查 Worker 与 D1 健康状态",
  "List posts, or return every post of one Asia/Shanghai date":
    "分页获取内容列表，或返回某个亚洲/上海日期下的全部内容",
  "Create a post": "创建内容",
  "Get daily post counts and a rendered administrator narrative":
    "获取每日发布数量与管理员统计文案",
  "Recompute statistics aggregates from the posts table":
    "从 posts 表重新计算统计聚合数据",
  "Pick a random post and return every post from its date":
    "随机选择一篇内容并返回当天的全部内容",
  "Get a post and its adjacent post IDs": "获取单篇内容及相邻内容 ID",
  "Update a post": "更新内容",
  "Soft-delete a post": "将内容移入回收站",
  "Restore a soft-deleted post": "恢复回收站内容",
  "List soft-deleted posts": "分页获取回收站内容",
  "Permanently delete a post and its managed hosted images":
    "永久删除内容及其托管图片",
  "Delete one hosted image and detach it from a post":
    "删除单张托管图片并从内容中移除其 URL",
  "Get an RSS 2.0 feed for the most recent 20 Shanghai calendar days":
    "获取最近 20 个亚洲/上海自然日的 RSS 2.0 订阅源",
  "Get authenticated administrator status": "获取当前用户的管理员状态",
  "The Worker can query D1.": "Worker 可以正常查询 D1。",
  "D1 is unavailable.": "D1 当前不可用。",
  "A newest-first cursor page, or a full day with navigation in date mode.":
    "按创建时间从新到旧排列的游标分页结果；日期模式下返回当天全部内容及导航。",
  "Invalid pagination cursor.": "分页游标无效。",
  "Invalid query parameters.": "查询参数无效。",
  "Unexpected server error.": "服务器发生意外错误。",
  "Post created.": "内容创建成功。",
  "Authentication required.": "需要登录。",
  "Administrator access required.": "需要管理员权限。",
  "Invalid request body.": "请求体无效。",
  "Authentication is not configured.": "身份认证尚未配置。",
  "Daily counts and a structured administrator narrative computed in Asia/Shanghai.":
    "按亚洲/上海时区计算的每日数量和结构化管理员统计文案。",
  "Fresh statistics after the rebuild.": "重建后的最新统计信息。",
  "The randomly selected Asia/Shanghai date and its posts.":
    "随机选中的亚洲/上海日期及当天内容。",
  "There are no posts to pick.": "当前没有可供随机选择的内容。",
  "The requested date has no posts.": "请求的日期没有内容。",
  "Post detail.": "内容详情。",
  "Post not found.": "内容不存在。",
  "Invalid post ID.": "内容 ID 无效。",
  "Post updated.": "内容更新成功。",
  "Hosted images must be deleted through the post image endpoint.":
    "托管图片必须通过内容图片删除接口移除。",
  "Invalid request.": "请求无效。",
  "Post moved to the recycle bin.": "内容已移入回收站。",
  "Post restored.": "内容恢复成功。",
  "Post is not deleted.": "内容不在回收站中。",
  "A newest-deleted-first cursor page.":
    "按删除时间从新到旧排列的回收站游标分页结果。",
  "Hosted images and post permanently deleted.": "托管图片和内容已永久删除。",
  "Hosted image deleted and post image list updated.":
    "托管图片已删除，内容图片列表已更新。",
  "Post or attached image not found.": "内容或其所附图片不存在。",
  "Deleting the image would empty the post.":
    "删除该图片后内容将为空，无法执行删除。",
  "An RSS 2.0 XML document containing public posts.":
    "包含公开内容的 RSS 2.0 XML 文档。",
  "Post is not in the trash.": "内容不在回收站中。",
  "Hosted image deletion failed.": "托管图片删除失败。",
  "Authentication or hosted image deletion is not configured.":
    "身份认证或托管图片删除服务尚未配置。",
  "Authentication status.": "当前用户的身份认证与管理员状态。",
};

const schemaPropertyDescriptions: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  Health: {
    status: "Worker 健康状态。",
    database: "D1 数据库健康状态。",
    timestamp: "服务器生成响应时的 ISO 8601 时间。",
  },
  Error: {
    error: "错误信息。",
    requestId: "用于日志追踪的请求 UUID。",
  },
  PostList: {
    items: "当前页内容列表。",
    nextCursor: "下一页游标；没有更多内容时为 null。日期模式下恒为 null。",
    date: "仅在日期模式（?date=）下返回：请求的亚洲/上海日期。",
    navigation: "仅在日期模式（?date=）下返回：相邻有内容日期的导航信息。",
  },
  Post: {
    id: "稳定的内容 UUID。",
    content: "规范化后的正文。图片内容允许为空字符串。",
    images: "内容所附的有序图片 URL 列表。",
    createdAt: "创建时间，ISO 8601 格式。",
    updatedAt: "最后更新时间，ISO 8601 格式。",
    edited: "内容是否在创建后编辑过。",
  },
  MomentStatistics: {
    days: "按亚洲/上海日期统计的每日发布数量。",
    administratorNarrative: "后端生成的结构化管理员统计文案。",
  },
  DailyMomentCount: {
    date: "亚洲/上海日历日期。",
    count: "当天发布且未删除的内容数量。",
  },
  NarrativeParagraph: { segments: "该段落包含的文本片段。" },
  NarrativeSegment: {
    text: "文本内容。",
    bold: "前端是否应以粗体渲染该片段。",
  },
  PostDetail: {
    post: "内容正文与元数据。",
    navigation: "相邻公开内容的 ID。",
  },
  WritePost: {
    content: "正文；保存前会规范化连续空格、制表符和换行。",
    images: "有序图片 URL 列表，最多 18 张；正文和图片至少提供一项。",
  },
  DeletePostImage: {
    imageUrl: "要删除的托管图片完整 URL。",
  },
  DeletedPostList: {
    items: "当前页回收站内容列表。",
    nextCursor: "下一页游标；没有更多内容时为 null。",
  },
  DeletedPost: {
    id: "稳定的内容 UUID。",
    content: "规范化后的正文。",
    images: "内容所附的有序图片 URL 列表。",
    createdAt: "创建时间，ISO 8601 格式。",
    updatedAt: "最后更新时间，ISO 8601 格式。",
    edited: "内容是否在创建后编辑过。",
    deletedAt: "移入回收站的时间，ISO 8601 格式。",
  },
  AuthStatus: {
    authenticated: "令牌是否已通过认证；成功响应固定为 true。",
    isAdmin: "当前 Clerk 用户是否为配置的管理员。",
  },
};

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function translate(value: JsonValue): JsonValue {
  if (typeof value === "string") return translations[value] ?? value;
  if (Array.isArray(value)) return value.map(translate);
  if (!isJsonObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, translate(child)]),
  );
}

function addSchemaPropertyDescriptions(document: JsonObject): void {
  const components = document.components;
  if (!isJsonObject(components)) return;
  const schemas = components.schemas;
  if (!isJsonObject(schemas)) return;

  for (const [schemaName, descriptions] of Object.entries(
    schemaPropertyDescriptions,
  )) {
    const schema = schemas[schemaName];
    if (!isJsonObject(schema)) continue;
    const properties = schema.properties;
    if (!isJsonObject(properties)) continue;
    for (const [propertyName, description] of Object.entries(descriptions)) {
      const property = properties[propertyName];
      if (isJsonObject(property)) property.description = description;
    }
  }
}

export function localizeOpenApiDocument(document: unknown): JsonObject {
  const cloned = JSON.parse(JSON.stringify(document)) as JsonValue;
  if (!isJsonObject(cloned))
    throw new Error("OpenAPI document is not an object.");
  const localized = translate(cloned);
  if (!isJsonObject(localized)) {
    throw new Error("Localized OpenAPI document is not an object.");
  }

  localized.servers = [
    {
      url: "http://localhost:8787",
      description: "本地 Wrangler 开发服务器；导入后可改为线上 API 地址。",
    },
  ];
  localized.tags = [
    { name: "系统", description: "服务元数据与健康状态。" },
    {
      name: "内容",
      description: "公开读取内容，以及管理员创建、编辑和删除内容。",
    },
    { name: "日期", description: "按亚洲/上海日期读取内容并导航。" },
    { name: "统计", description: "每日发布统计与管理员统计文案。" },
    { name: "回收站", description: "管理员查看、恢复和永久删除内容。" },
    { name: "身份认证", description: "Clerk 会话与管理员状态。" },
  ];
  addSchemaPropertyDescriptions(localized);
  return localized;
}
