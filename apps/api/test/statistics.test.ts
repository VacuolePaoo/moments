import { describe, expect, it } from "vitest";

import {
  buildAdministratorNarrative,
  type StatisticsDay,
} from "../src/lib/statistics";

function day(date: string, count = 1, imageCount = count): StatisticsDay {
  return {
    date,
    count,
    characterCount: count * 2,
    longestPostCharacters: 2,
    imageCount,
  };
}

function text(days: StatisticsDay[], today: string): string {
  return buildAdministratorNarrative(days, [{ hour: 9, count: 1 }], today)
    .flatMap((paragraph) => paragraph.segments)
    .map((segment) => segment.text)
    .join("");
}

describe("administrator statistics narrative", () => {
  it("returns no narrative when there are no public posts", () => {
    expect(buildAdministratorNarrative([], [], "2026-08-13")).toEqual([]);
  });

  it("shows only the collection prompt before six active days", () => {
    const days = Array.from({ length: 5 }, (_, index) =>
      day(`2026-08-${String(index + 1).padStart(2, "0")}`),
    );
    expect(buildAdministratorNarrative(days, [], "2026-08-13")).toEqual([
      {
        segments: [
          {
            text: "坚持下去，Moments正在为你统计数据",
            bold: false,
          },
        ],
      },
    ]);
  });

  it("uses the writing copy when at least six active days contain no images", () => {
    const days = Array.from({ length: 6 }, (_, index) =>
      day(`2026-08-${String(index + 1).padStart(2, "0")}`, 1, 0),
    );
    expect(text(days, "2026-08-06")).toContain(
      "你在这里留下的moment，似乎只有文字，看来你是一个喜欢写作的人",
    );
    expect(text(days, "2026-08-06")).not.toContain("张照片");
  });

  it("describes a 20-day recording streak with the long-streak copy", () => {
    const days = Array.from({ length: 20 }, (_, index) =>
      day(`2026-07-${String(index + 1).padStart(2, "0")}`),
    );
    const narrative = text(days, "2026-07-20");
    expect(narrative).toContain("20 天");
    expect(narrative).toMatch(
      /最长连续记录了 20 天|最长的一次连续记录持续了 20 天/u,
    );
  });

  it("includes current trailing silence and classifies more than 30 days as frequent silence", () => {
    const days = Array.from({ length: 6 }, (_, index) =>
      day(`2026-06-${String(index + 1).padStart(2, "0")}`),
    );
    expect(text(days, "2026-08-13")).toContain("有时候一个月甚至更久");
  });

  it("omits silence copy below five days", () => {
    const days = Array.from({ length: 6 }, (_, index) =>
      day(`2026-01-${String(index + 1).padStart(2, "0")}`),
    );
    const narrative = text(days, "2026-01-08");
    expect(narrative).not.toContain("最长的一次空白");
    expect(narrative).not.toContain("最长的一次沉默");
  });

  it("omits this-year peak without this-year posts", () => {
    const days = Array.from({ length: 6 }, (_, index) =>
      day(`2025-12-${String(index + 1).padStart(2, "0")}`),
    );
    const narrative = text(days, "2026-01-08");
    expect(narrative).not.toContain("今年，你发布最多的一天");
  });
});
