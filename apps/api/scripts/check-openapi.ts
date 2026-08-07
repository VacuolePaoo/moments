import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createApp } from "../src/app";
import { openApiConfig } from "../src/openapi";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(scriptDirectory, "../openapi/openapi.json");
const expected = `${JSON.stringify(createApp().getOpenAPI31Document(openApiConfig), null, 2)}\n`;
const actual = await readFile(outputPath, "utf8");

if (actual !== expected) {
  throw new Error("openapi/openapi.json is stale. Run pnpm openapi:generate.");
}
console.log("OpenAPI artifact is up to date.");

