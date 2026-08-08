interface Env {
  ALLOWED_ORIGIN: string;
  CLERK_JWT_KEY: string;
  ADMIN_CLERK_USER_ID: string;
}

declare namespace Cloudflare {
  interface Env {
    ALLOWED_ORIGIN: string;
    CLERK_JWT_KEY: string;
    ADMIN_CLERK_USER_ID: string;
  }
}
