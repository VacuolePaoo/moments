import { describe, expect, it } from "vitest";

import { normalizeContent } from "../src/lib/content";

describe("normalizeContent", () => {
  it("collapses spaces, tabs, CRLF and consecutive line breaks", () => {
    expect(normalizeContent("  第一段\t\t内容\r\n\r\n\r\n第二段    内容  ")).toBe(
      "第一段 内容\n第二段 内容",
    );
  });

  it("keeps emoji and URLs unchanged", () => {
    expect(normalizeContent("🙂  https://example.com/a?b=1")).toBe(
      "🙂 https://example.com/a?b=1",
    );
  });
});

