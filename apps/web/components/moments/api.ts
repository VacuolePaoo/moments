export interface MomentPost {
  id: string;
  content: string;
  images: string[];
  createdAt: string;
  updatedAt: string;
  edited: boolean;
}

export interface DateNavigation {
  newerDate: string | null;
  olderDate: string | null;
}

export interface PostList {
  items: MomentPost[];
  nextCursor: string | null;
  date?: string;
  navigation?: DateNavigation;
}

export interface DeletedMomentPost extends MomentPost {
  deletedAt: string;
}

export interface DeletedPostList {
  items: DeletedMomentPost[];
  nextCursor: string | null;
}

export interface DateDetail {
  date: string;
  items: MomentPost[];
  navigation: {
    newerDate: string | null;
    olderDate: string | null;
  };
}

export interface MomentStatistics {
  days: Array<{ date: string; count: number }>;
  administratorNarrative: Array<{
    segments: Array<{ text: string; bold: boolean }>;
  }>;
}

export const MAX_IMAGES_PER_POST = 18;

export interface AuthStatus {
  authenticated: true;
  isAdmin: boolean;
}

interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
  };
  requestId?: string;
}

const configuredBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
const API_BASE_URL = (configuredBaseUrl ?? "http://localhost:8787").replace(
  /\/$/,
  "",
);

export class MomentsApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "MomentsApiError";
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  token?: string;
  body?: { content: string; images: string[] };
  signal?: AbortSignal;
}

async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const headers = new Headers();
  if (options.token) headers.set("Authorization", `Bearer ${options.token}`);
  if (options.body) headers.set("Content-Type", "application/json");

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });

  if (!response.ok) {
    let body: ApiErrorBody = {};
    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      // The status code still provides a stable fallback for non-JSON failures.
    }
    throw new MomentsApiError(
      response.status,
      body.error?.code ?? "REQUEST_FAILED",
      body.error?.message ?? "请求失败。",
      body.requestId,
    );
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function isRetryableReadError(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (error instanceof MomentsApiError &&
      (error.status === 408 || error.status === 429 || error.status >= 500))
  );
}

export async function retryRead<T>(
  task: () => Promise<T>,
  attempts = 3,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (!isRetryableReadError(error) || attempt === attempts - 1) throw error;
      await new Promise((resolve) =>
        window.setTimeout(resolve, 250 * (attempt + 1)),
      );
    }
  }
  throw lastError;
}

export function listPosts(
  options: {
    limit?: number;
    cursor?: string;
    anchorDate?: string;
    date?: string;
    signal?: AbortSignal;
  } = {},
): Promise<PostList> {
  const query = new URLSearchParams({ limit: String(options.limit ?? 20) });
  if (options.cursor) query.set("cursor", options.cursor);
  if (options.anchorDate) query.set("anchorDate", options.anchorDate);
  if (options.date) query.set("date", options.date);
  return request<PostList>(`/api/v1/posts?${query.toString()}`, {
    signal: options.signal,
  });
}

export async function getDateDetail(
  date: string,
  signal?: AbortSignal,
): Promise<DateDetail> {
  const page = await listPosts({ date, signal });
  if (page.date === undefined || page.navigation === undefined) {
    throw new MomentsApiError(
      500,
      "INVALID_RESPONSE",
      "返回的日期数据不完整。",
    );
  }
  return { date: page.date, items: page.items, navigation: page.navigation };
}

export function getMomentStatistics(
  token: string,
  signal?: AbortSignal,
): Promise<MomentStatistics> {
  return request<MomentStatistics>("/api/v1/statistics", { token, signal });
}

export function rebuildStatistics(token: string): Promise<MomentStatistics> {
  return request<MomentStatistics>("/api/v1/statistics/rebuild", {
    method: "POST",
    token,
  });
}

export async function getRandomMomentDate(
  signal?: AbortSignal,
): Promise<DateDetail> {
  const page = await request<PostList>("/api/v1/random", { signal });
  if (page.date === undefined || page.navigation === undefined) {
    throw new MomentsApiError(
      500,
      "INVALID_RESPONSE",
      "返回的日期数据不完整。",
    );
  }
  return { date: page.date, items: page.items, navigation: page.navigation };
}

export function getAuthStatus(
  token: string,
  signal?: AbortSignal,
): Promise<AuthStatus> {
  return request<AuthStatus>("/api/v1/auth/me", { token, signal });
}

export function createPost(
  content: string,
  images: string[],
  token: string,
): Promise<MomentPost> {
  return request<MomentPost>("/api/v1/posts", {
    method: "POST",
    token,
    body: { content, images },
  });
}

export function updatePost(
  id: string,
  content: string,
  images: string[],
  token: string,
): Promise<MomentPost> {
  return request<MomentPost>(`/api/v1/posts/${encodeURIComponent(id)}`, {
    method: "PATCH",
    token,
    body: { content, images },
  });
}

export function deletePost(id: string, token: string): Promise<void> {
  return request<void>(`/api/v1/posts/${encodeURIComponent(id)}`, {
    method: "DELETE",
    token,
  });
}

export function restorePost(id: string, token: string): Promise<MomentPost> {
  return request<MomentPost>(
    `/api/v1/posts/${encodeURIComponent(id)}/restore`,
    {
      method: "POST",
      token,
    },
  );
}

export function listDeletedPosts(
  token: string,
  options: { limit?: number; cursor?: string; signal?: AbortSignal } = {},
): Promise<DeletedPostList> {
  const query = new URLSearchParams({ limit: String(options.limit ?? 20) });
  if (options.cursor) query.set("cursor", options.cursor);
  return request<DeletedPostList>(`/api/v1/trash?${query.toString()}`, {
    token,
    signal: options.signal,
  });
}

export function permanentlyDeletePost(
  id: string,
  token: string,
): Promise<void> {
  return request<void>(`/api/v1/trash/${encodeURIComponent(id)}`, {
    method: "DELETE",
    token,
  });
}

export async function uploadImage(file: File, token: string): Promise<string> {
  const form = new FormData();
  form.set("file", file, file.name);
  const response = await fetch("/api/uploads", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const body = (await response.json().catch(() => ({}))) as {
    url?: unknown;
    error?: { message?: unknown };
  };
  if (!response.ok || typeof body.url !== "string") {
    throw new Error(
      typeof body.error?.message === "string"
        ? body.error.message
        : "图片上传失败。",
    );
  }
  return body.url;
}
