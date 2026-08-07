import type { OpenAPIHono } from "@hono/zod-openapi";

type OpenApi31Config = Parameters<OpenAPIHono["getOpenAPI31Document"]>[0];

export const openApiConfig: OpenApi31Config = {
  openapi: "3.1.0",
  info: {
    title: "Moments API",
    version: "1.0.0",
    description: "Public read and Clerk-protected write API for a personal Moments site.",
  },
  servers: [{ url: "/" }],
  tags: [
    { name: "System", description: "Service metadata and health." },
    { name: "Posts", description: "Public post reads and administrator mutations." },
    { name: "Authentication", description: "Clerk session and administrator status." },
  ],
};
