import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  localizedOpenApiOutputPath,
  openApiOutputPath,
  serializeOpenApiDocument,
  serializeLocalizedOpenApiDocument,
} from "./openapi-artifact";

await mkdir(dirname(openApiOutputPath), { recursive: true });
await Promise.all([
  writeFile(openApiOutputPath, serializeOpenApiDocument(), "utf8"),
  writeFile(
    localizedOpenApiOutputPath,
    serializeLocalizedOpenApiDocument(),
    "utf8",
  ),
]);
console.log(`Generated ${openApiOutputPath}`);
console.log(`Generated ${localizedOpenApiOutputPath}`);
