import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createApp } from "../src/app";
import { openApiConfig } from "../src/openapi";
import { localizeOpenApiDocument } from "./openapi-localization";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));

export const openApiOutputPath = resolve(
  scriptDirectory,
  "../openapi/openapi.json",
);

export const localizedOpenApiOutputPath = resolve(
  scriptDirectory,
  "../openapi/openapi.zh-CN.json",
);

function openApiDocument() {
  return createApp().getOpenAPI31Document(openApiConfig);
}

export function serializeOpenApiDocument(): string {
  return `${JSON.stringify(openApiDocument(), null, 2)}\n`;
}

export function serializeLocalizedOpenApiDocument(): string {
  return `${JSON.stringify(localizeOpenApiDocument(openApiDocument()), null, 2)}\n`;
}
