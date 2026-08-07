import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import type { AppEnv } from "../types";

export type ApiErrorStatus = 400 | 401 | 403 | 404 | 409 | 422 | 500 | 503;

export interface ErrorDetail {
  path: string;
  message: string;
}

export class ApiError extends Error {
  override readonly name = "ApiError";

  constructor(
    readonly status: ApiErrorStatus,
    readonly code: string,
    message: string,
    readonly details?: ErrorDetail[],
  ) {
    super(message);
  }
}

export function errorBody(
  requestId: string,
  code: string,
  message: string,
  details?: ErrorDetail[],
) {
  return {
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
    },
    requestId,
  };
}

export function errorResponse(
  c: Context<AppEnv>,
  status: ContentfulStatusCode,
  code: string,
  message: string,
  details?: ErrorDetail[],
) {
  return c.json(errorBody(c.get("requestId"), code, message, details), status);
}
