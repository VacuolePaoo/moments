import { z } from "@hono/zod-openapi";

const CursorPayloadSchema = z.object({
  createdAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
});

export type CursorPayload = z.infer<typeof CursorPayloadSchema>;

export class InvalidCursorError extends Error {
  override readonly name = "InvalidCursorError";
}

export function encodeCursor(payload: CursorPayload): string {
  const encoded = btoa(JSON.stringify(payload));
  return encoded.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function decodeCursor(value: string): CursorPayload {
  try {
    const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    return CursorPayloadSchema.parse(JSON.parse(atob(padded)));
  } catch {
    throw new InvalidCursorError("The pagination cursor is invalid.");
  }
}
