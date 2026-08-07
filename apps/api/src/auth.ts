import { verifyToken } from "@clerk/backend";
import type { MiddlewareHandler } from "hono";

import { ApiError } from "./lib/errors";
import type { AppEnv, TokenVerifier } from "./types";

export const verifyClerkSession: TokenVerifier = async (token, env) => {
  if (
    typeof env.CLERK_JWT_KEY !== "string" ||
    env.CLERK_JWT_KEY.length === 0 ||
    typeof env.ALLOWED_ORIGIN !== "string" ||
    env.ALLOWED_ORIGIN.length === 0
  ) {
    throw new ApiError(
      503,
      "AUTH_NOT_CONFIGURED",
      "Authentication is not configured.",
    );
  }

  try {
    const claims = await verifyToken(token, {
      jwtKey: env.CLERK_JWT_KEY.replaceAll("\\n", "\n"),
      authorizedParties: [env.ALLOWED_ORIGIN],
    });

    if (typeof claims.sub !== "string" || claims.sub.length === 0) {
      throw new Error("The verified Clerk token does not contain a subject.");
    }

    return { userId: claims.sub };
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(
      401,
      "INVALID_TOKEN",
      "The Clerk session token is invalid or expired.",
    );
  }
};

function extractBearerToken(header: string | undefined): string {
  const match = /^Bearer\s+(.+)$/iu.exec(header ?? "");
  if (match?.[1] === undefined || match[1].length === 0) {
    throw new ApiError(
      401,
      "AUTHENTICATION_REQUIRED",
      "A Clerk bearer token is required.",
    );
  }
  return match[1];
}

export function requireAuthentication(
  verifier: TokenVerifier,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const token = extractBearerToken(c.req.header("Authorization"));
    const session = await verifier(token, c.env);
    c.set("authenticatedUserId", session.userId);
    await next();
  };
}

export function requireAdministrator(
  verifier: TokenVerifier,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (
      typeof c.env.ADMIN_CLERK_USER_ID !== "string" ||
      c.env.ADMIN_CLERK_USER_ID.length === 0
    ) {
      throw new ApiError(
        503,
        "AUTH_NOT_CONFIGURED",
        "Administrator access is not configured.",
      );
    }
    const token = extractBearerToken(c.req.header("Authorization"));
    const session = await verifier(token, c.env);
    c.set("authenticatedUserId", session.userId);
    if (session.userId !== c.env.ADMIN_CLERK_USER_ID) {
      throw new ApiError(
        403,
        "ADMIN_REQUIRED",
        "Administrator access is required.",
      );
    }
    await next();
  };
}

export function requireAdministratorForMethods(
  verifier: TokenVerifier,
  methods: readonly string[],
): MiddlewareHandler<AppEnv> {
  const methodSet = new Set(methods);
  return async (c, next) => {
    if (!methodSet.has(c.req.method)) {
      await next();
      return;
    }

    if (
      typeof c.env.ADMIN_CLERK_USER_ID !== "string" ||
      c.env.ADMIN_CLERK_USER_ID.length === 0
    ) {
      throw new ApiError(
        503,
        "AUTH_NOT_CONFIGURED",
        "Administrator access is not configured.",
      );
    }
    const token = extractBearerToken(c.req.header("Authorization"));
    const session = await verifier(token, c.env);
    c.set("authenticatedUserId", session.userId);
    if (session.userId !== c.env.ADMIN_CLERK_USER_ID) {
      throw new ApiError(
        403,
        "ADMIN_REQUIRED",
        "Administrator access is required.",
      );
    }
    await next();
  };
}
