import type { OpenAPIHono } from "@hono/zod-openapi";

type OpenApi31Config = Parameters<OpenAPIHono["getOpenAPI31Document"]>[0];

export const openApiConfig: OpenApi31Config = {
  openapi: "3.1.0",
  info: {
    title: "Moments API",
    version: "2.1.0",
    description:
      "Configurable read and Clerk-protected administration API for a personal Moments site, with D1-backed feature settings and maintenance operations.",
  },
  servers: [{ url: "/" }],
  tags: [
    { name: "System", description: "Service metadata and health." },
    {
      name: "Posts",
      description:
        "Public post reads (feed, date mode, random) and administrator mutations.",
    },
    {
      name: "Statistics",
      description:
        "Aggregated posting statistics and administrator maintenance.",
    },
    {
      name: "Trash",
      description: "Administrator recycle bin management.",
    },
    {
      name: "Authentication",
      description: "Clerk session and administrator status.",
    },
    {
      name: "Settings",
      description: "Public runtime settings and administrator updates.",
    },
    {
      name: "Maintenance",
      description: "Administrator backup and destructive data maintenance.",
    },
  ],
};
