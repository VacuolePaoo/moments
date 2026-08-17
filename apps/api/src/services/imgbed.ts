import { ApiError } from "../lib/errors";
import type { ImgBedBindings } from "../types";

const MAX_DELETE_BATCH_SIZE = 500;
const MAX_SINGLE_DELETE_CONCURRENCY = 6;

interface ImgBedDeleteResponse {
  success?: unknown;
  deleted?: unknown;
  failed?: unknown;
  fileId?: unknown;
}

export type ImgBedFetch = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function configuredImgBed(env: ImgBedBindings) {
  const rawBaseUrl = env.CFBED_BASE_URL?.replace(/\/+$/u, "");
  const token = env.CFBED_API_TOKEN;
  if (!rawBaseUrl || !token) {
    throw new ApiError(
      503,
      "IMAGE_DELETE_NOT_CONFIGURED",
      "Image deletion is not configured.",
    );
  }

  let baseUrl: URL;
  try {
    baseUrl = new URL(rawBaseUrl);
  } catch {
    throw new ApiError(
      503,
      "IMAGE_DELETE_NOT_CONFIGURED",
      "Image deletion is not configured.",
    );
  }
  if (baseUrl.protocol !== "https:" && baseUrl.protocol !== "http:") {
    throw new ApiError(
      503,
      "IMAGE_DELETE_NOT_CONFIGURED",
      "Image deletion is not configured.",
    );
  }
  return { baseUrl, token, endpoint: `${rawBaseUrl}/api/manage/delete/batch` };
}

async function requestImgBed(
  input: string,
  init: RequestInit,
  fetcher: ImgBedFetch,
): Promise<{ response: Response; result: ImgBedDeleteResponse }> {
  let response: Response;
  try {
    response = await fetcher(input, init);
  } catch {
    throw new ApiError(
      502,
      "IMAGE_DELETE_FAILED",
      "The image service could not be reached.",
    );
  }

  try {
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) throw new Error();
    return { response, result: body };
  } catch {
    throw new ApiError(
      502,
      "IMAGE_DELETE_FAILED",
      "The image service returned an invalid response.",
    );
  }
}

export function imgBedFileIdFromUrl(
  imageUrl: string,
  baseUrl: URL,
): string | null {
  let candidate: URL;
  try {
    candidate = new URL(imageUrl);
  } catch {
    return null;
  }
  if (candidate.origin !== baseUrl.origin) return null;

  const basePath = baseUrl.pathname.replace(/\/+$/u, "");
  const filePrefix = `${basePath}/file/`;
  if (!candidate.pathname.startsWith(filePrefix)) return null;

  const encodedFileId = candidate.pathname.slice(filePrefix.length);
  if (encodedFileId.length === 0) return null;

  try {
    const fileId = decodeURIComponent(encodedFileId);
    const segments = fileId.split("/");
    return segments.some(
      (segment) => segment.length === 0 || segment === "." || segment === "..",
    )
      ? null
      : fileId;
  } catch {
    return null;
  }
}

async function deleteBatch(
  endpoint: string,
  token: string,
  fileIds: string[],
  fetcher: ImgBedFetch,
): Promise<string[]> {
  const { response, result } = await requestImgBed(
    endpoint,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fileIds }),
    },
    fetcher,
  );

  if (!response.ok) {
    throw new ApiError(
      502,
      "IMAGE_DELETE_FAILED",
      "One or more hosted images could not be deleted.",
    );
  }

  if (result.success === true && result.fileId === "batch") {
    // This is not a documented batch response and does not identify which
    // requested files were deleted. Retry every file through the documented
    // single-file endpoint before allowing the D1 row to be removed.
    return fileIds;
  }

  if (!isUnknownArray(result.deleted) || !isUnknownArray(result.failed)) {
    throw new ApiError(
      502,
      "IMAGE_DELETE_FAILED",
      "The image service returned an invalid response.",
    );
  }

  const deletedValues = result.deleted.filter(
    (fileId): fileId is string => typeof fileId === "string",
  );
  if (deletedValues.length !== result.deleted.length) {
    throw new ApiError(
      502,
      "IMAGE_DELETE_FAILED",
      "The image service returned an invalid response.",
    );
  }
  const deleted = new Set(deletedValues);
  const failed = result.failed.flatMap((failure) => {
    if (
      typeof failure !== "object" ||
      failure === null ||
      !("fileId" in failure)
    ) {
      return [];
    }
    const fileId = failure.fileId;
    return typeof fileId === "string" ? [fileId] : [];
  });
  if (failed.length !== result.failed.length) {
    throw new ApiError(
      502,
      "IMAGE_DELETE_FAILED",
      "The image service returned an invalid response.",
    );
  }
  if (
    result.success === true &&
    failed.length === 0 &&
    fileIds.every((fileId) => deleted.has(fileId))
  ) {
    return [];
  }

  const remaining = fileIds.filter((fileId) => !deleted.has(fileId));
  if (remaining.length > 0) return remaining;

  throw new ApiError(
    502,
    "IMAGE_DELETE_FAILED",
    "One or more hosted images could not be deleted.",
  );
}

function encodedFileId(fileId: string): string {
  return fileId.split("/").map(encodeURIComponent).join("/");
}

async function deleteSingle(
  baseUrl: URL,
  token: string,
  fileId: string,
  fetcher: ImgBedFetch,
): Promise<void> {
  const basePath = baseUrl.pathname.replace(/\/+$/u, "");
  const endpoint = `${baseUrl.origin}${basePath}/api/manage/delete/${encodedFileId(fileId)}`;

  const { response, result } = await requestImgBed(
    endpoint,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
    fetcher,
  );

  if (!response.ok || result.success !== true || result.fileId !== fileId) {
    throw new ApiError(
      502,
      "IMAGE_DELETE_FAILED",
      "The hosted image could not be deleted.",
    );
  }
}

async function deleteSingles(
  baseUrl: URL,
  token: string,
  fileIds: string[],
  fetcher: ImgBedFetch,
): Promise<void> {
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(MAX_SINGLE_DELETE_CONCURRENCY, fileIds.length) },
    async () => {
      while (nextIndex < fileIds.length) {
        const fileId = fileIds[nextIndex];
        nextIndex += 1;
        if (fileId !== undefined) {
          await deleteSingle(baseUrl, token, fileId, fetcher);
        }
      }
    },
  );
  const results = await Promise.allSettled(workers);
  const failure = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failure) {
    if (failure.reason instanceof Error) throw failure.reason;
    throw new Error("Image deletion failed with a non-error rejection.");
  }
}

export async function deleteImgBedImages(
  images: string[],
  env: ImgBedBindings,
  fetcher: ImgBedFetch = fetch,
): Promise<void> {
  if (images.length === 0) return;

  const { baseUrl, endpoint, token } = configuredImgBed(env);
  const fileIds = [
    ...new Set(
      images.flatMap((image) => {
        const fileId = imgBedFileIdFromUrl(image, baseUrl);
        return fileId === null ? [] : [fileId];
      }),
    ),
  ];
  if (fileIds.length === 0) return;

  if (fileIds.length === 1) {
    const fileId = fileIds[0];
    if (fileId === undefined) return;
    await deleteSingle(baseUrl, token, fileId, fetcher);
    return;
  }

  for (let start = 0; start < fileIds.length; start += MAX_DELETE_BATCH_SIZE) {
    const batch = fileIds.slice(start, start + MAX_DELETE_BATCH_SIZE);
    if (batch.length === 1) {
      const fileId = batch[0];
      if (fileId === undefined) continue;
      await deleteSingle(baseUrl, token, fileId, fetcher);
    } else {
      const remaining = await deleteBatch(endpoint, token, batch, fetcher);
      await deleteSingles(baseUrl, token, remaining, fetcher);
    }
  }
}
