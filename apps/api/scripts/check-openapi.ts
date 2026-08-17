import { readFile } from "node:fs/promises";

import {
  localizedOpenApiOutputPath,
  openApiOutputPath,
  serializeOpenApiDocument,
  serializeLocalizedOpenApiDocument,
} from "./openapi-artifact";

const expected = serializeOpenApiDocument();
const expectedLocalized = serializeLocalizedOpenApiDocument();
const [actual, actualLocalized] = await Promise.all([
  readFile(openApiOutputPath, "utf8"),
  readFile(localizedOpenApiOutputPath, "utf8"),
]);

if (actual !== expected || actualLocalized !== expectedLocalized) {
  throw new Error("OpenAPI artifacts are stale. Run pnpm openapi:generate.");
}
console.log("OpenAPI artifacts are up to date.");
