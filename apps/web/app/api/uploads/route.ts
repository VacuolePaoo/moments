interface AuthStatus {
  authenticated: true;
  isAdmin: boolean;
}

interface ImgBedUploadResult {
  src?: unknown;
  publicUrl?: unknown;
}

function jsonError(status: number, message: string) {
  return Response.json({ error: { message } }, { status });
}

function workerBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8787"
  ).replace(/\/$/u, "");
}

async function isAdministrator(token: string): Promise<boolean> {
  const response = await fetch(`${workerBaseUrl()}/api/v1/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!response.ok) return false;
  const status = (await response.json()) as AuthStatus;
  return status.authenticated && status.isAdmin;
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
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const authorization = request.headers.get("Authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/iu)?.[1];
  if (!token) return jsonError(401, "需要登录后上传图片。");

  try {
    if (!(await isAdministrator(token))) {
      return jsonError(403, "只有管理员可以上传图片。");
    }
  } catch {
    return jsonError(502, "暂时无法验证管理员身份。");
  }

  const baseUrl = process.env.CFBED_BASE_URL?.replace(/\/$/u, "");
  const apiToken = process.env.CFBED_API_TOKEN;
  if (!baseUrl || !apiToken) {
    return jsonError(503, "图片上传服务尚未配置。");
  }

  let incoming: FormData;
  try {
    incoming = await request.formData();
  } catch {
    return jsonError(422, "上传请求格式无效。");
  }
  const file = incoming.get("file");
  if (!(file instanceof File) || !file.type.startsWith("image/")) {
    return jsonError(422, "请选择有效的图片文件。");
  }

  const query = new URLSearchParams({ returnFormat: "full" });
  const uploadFolder = process.env.CFBED_UPLOAD_FOLDER;
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
    return jsonError(502, "无法连接图片上传服务。");
  }

  if (!response.ok) {
    return jsonError(502, "图片上传服务拒绝了本次上传。");
  }

  let results: ImgBedUploadResult[];
  try {
    const body: unknown = await response.json();
    if (!Array.isArray(body)) throw new Error("Invalid upload response.");
    results = body as ImgBedUploadResult[];
  } catch {
    return jsonError(502, "图片上传服务返回了无效结果。");
  }

  const url = results[0] ? resolveUploadedUrl(baseUrl, results[0]) : null;
  return url
    ? Response.json({ url })
    : jsonError(502, "图片上传结果中没有可用链接。");
}
