import { isSecureEndpoint, workerApiBaseUrl } from "@/lib/worker-api";

interface ImgBedUploadResult {
  src?: unknown;
  publicUrl?: unknown;
}

interface WorkerErrorBody {
  error?: {
    code?: unknown;
    message?: unknown;
  };
  requestId?: unknown;
}

class WorkerAuthenticationError extends Error {
  constructor(
    readonly status: number,
    readonly code?: string,
    readonly requestId?: string,
    message?: string,
  ) {
    super(message);
    this.name = "WorkerAuthenticationError";
  }
}

const MAX_IMAGE_BYTES = 64 * 1024 * 1024;
const MAX_RECORDING_BYTES = 32 * 1024 * 1024;
const MAX_MULTIPART_BYTES = MAX_IMAGE_BYTES + 1024 * 1024;

function jsonError(
  status: number,
  message: string,
  code?: string,
  requestId?: string,
) {
  return Response.json(
    {
      error: { ...(code ? { code } : {}), message },
      ...(requestId ? { requestId } : {}),
    },
    { status },
  );
}

function imgBedBaseUrl(): string | null {
  const configured = process.env.CFBED_BASE_URL?.replace(/\/+$/u, "");
  if (!configured) return null;
  try {
    const url = new URL(configured);
    return isSecureEndpoint(url) ? configured : null;
  } catch {
    return null;
  }
}

async function isAdministrator(token: string): Promise<boolean> {
  const response = await fetch(`${workerApiBaseUrl()}/api/v1/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!response.ok) {
    const body: WorkerErrorBody = await response.json().catch(() => ({}));
    const code = typeof body.error?.code === "string" ? body.error.code : undefined;
    const message =
      typeof body.error?.message === "string"
        ? body.error.message
        : "Worker 未返回可识别的错误原因。";
    const requestId =
      typeof body.requestId === "string" ? body.requestId : undefined;
    throw new WorkerAuthenticationError(
      response.status,
      code,
      requestId,
      message,
    );
  }
  const status: unknown = await response.json();
  const isAdministrator =
    typeof status === "object" &&
    status !== null &&
    "authenticated" in status &&
    status.authenticated === true &&
    "isAdmin" in status &&
    status.isAdmin === true;
  if (
    !isAdministrator &&
    (!status ||
      typeof status !== "object" ||
      !("authenticated" in status) ||
      status.authenticated !== true ||
      !("isAdmin" in status) ||
      typeof status.isAdmin !== "boolean")
  ) {
    throw new WorkerAuthenticationError(
      502,
      "INVALID_AUTH_STATUS",
      undefined,
      "Worker 返回了无效的管理员身份校验结果。",
    );
  }
  return isAdministrator;
}

function resolveUploadedUrl(
  baseUrl: string,
  result: ImgBedUploadResult,
): string | null {
  const value =
    typeof result.src === "string"
      ? result.src
      : typeof result.publicUrl === "string"
        ? result.publicUrl
        : null;
  if (!value) return null;
  try {
    const url = new URL(value, `${baseUrl}/`);
    return isSecureEndpoint(url) ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const authorization = request.headers.get("Authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/iu)?.[1];
  if (!token) return jsonError(401, "需要登录后上传文件。");

  const contentLength = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_MULTIPART_BYTES) {
    return jsonError(413, "上传文件过大。");
  }

  try {
    if (!(await isAdministrator(token))) {
      return jsonError(403, "只有管理员可以上传文件。");
    }
  } catch (error) {
    if (error instanceof WorkerAuthenticationError) {
      const details = [
        `Worker HTTP ${error.status}`,
        error.code,
        error.message,
        error.requestId ? `请求 ID：${error.requestId}` : undefined,
      ]
        .filter(Boolean)
        .join("；");
      return jsonError(
        error.status,
        `管理员身份校验失败：${details}`,
        error.code,
        error.requestId,
      );
    }
    return jsonError(
      502,
      `无法连接 Worker 以验证管理员身份：${error instanceof Error ? error.message : "未知错误。"}`,
      "WORKER_AUTH_UNREACHABLE",
    );
  }

  const baseUrl = imgBedBaseUrl();
  const apiToken = process.env.CFBED_API_TOKEN;
  if (!baseUrl || !apiToken) {
    return jsonError(503, "文件托管服务尚未配置。");
  }

  let incoming: FormData;
  try {
    incoming = await request.formData();
  } catch {
    return jsonError(422, "上传请求格式无效。");
  }
  const file = incoming.get("file");
  const kind = incoming.get("kind") === "recording" ? "recording" : "image";
  const expectedType = kind === "recording" ? "audio/" : "image/";
  if (!(file instanceof File) || !file.type.startsWith(expectedType)) {
    return jsonError(
      422,
      kind === "recording"
        ? "请选择有效的录音文件。"
        : "请选择有效的图片文件。",
    );
  }
  const maxBytes = kind === "recording" ? MAX_RECORDING_BYTES : MAX_IMAGE_BYTES;
  if (file.size === 0 || file.size > maxBytes) {
    return jsonError(413, "上传文件大小无效或超过限制。");
  }

  const query = new URLSearchParams({ returnFormat: "full" });
  const uploadFolder =
    kind === "recording" ? "recording" : process.env.CFBED_UPLOAD_FOLDER;
  if (uploadFolder) query.set("uploadFolder", uploadFolder);

  const outgoing = new FormData();
  outgoing.set("file", file, file.name);

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/upload?${query.toString()}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiToken}` },
      body: outgoing,
      cache: "no-store",
    });
  } catch {
    return jsonError(502, "无法连接文件托管服务。");
  }

  if (!response.ok) {
    return jsonError(502, "文件托管服务拒绝了本次上传。");
  }

  let results: ImgBedUploadResult[];
  try {
    const body: unknown = await response.json();
    if (!Array.isArray(body)) throw new Error("Invalid upload response.");
    results = body as ImgBedUploadResult[];
  } catch {
    return jsonError(502, "文件托管服务返回了无效结果。");
  }

  const url = results[0] ? resolveUploadedUrl(baseUrl, results[0]) : null;
  return url
    ? Response.json({ url, mimeType: file.type, sizeBytes: file.size })
    : jsonError(502, "文件上传结果中没有可用链接。");
}
