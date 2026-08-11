import type { MomentPost } from "./api";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const datePartsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const weekdayFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  weekday: "long",
});
const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Shanghai",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function isValidDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const instant = new Date(`${value}T00:00:00+08:00`);
  return (
    Number.isFinite(instant.getTime()) &&
    toShanghaiDate(instant.toISOString()) === value
  );
}

export function toShanghaiDate(isoTimestamp: string): string {
  const parts = datePartsFormatter.formatToParts(new Date(isoTimestamp));
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) throw new Error("无法解析发布日期。");
  return `${year}-${month}-${day}`;
}

export function formatDateHeading(date: string): string {
  if (!isValidDate(date)) return date;
  const [year, month, day] = date.split("-");
  const weekday = weekdayFormatter.format(new Date(`${date}T12:00:00+08:00`));
  return `${year}年${Number(month)}月${Number(day)}日 ${weekday}`;
}

export function formatPostTime(isoTimestamp: string): string {
  return timeFormatter.format(new Date(isoTimestamp));
}

export function sortPosts(posts: MomentPost[]): MomentPost[] {
  return [...posts].sort((left, right) => {
    const byTime = right.createdAt.localeCompare(left.createdAt);
    return byTime === 0 ? right.id.localeCompare(left.id) : byTime;
  });
}

export function mergePosts(
  current: MomentPost[],
  incoming: MomentPost[],
): MomentPost[] {
  const byId = new Map(current.map((post) => [post.id, post]));
  for (const post of incoming) byId.set(post.id, post);
  return sortPosts([...byId.values()]);
}

export function groupPostsByDate(posts: MomentPost[]): Array<{
  date: string;
  items: MomentPost[];
}> {
  const groups = new Map<string, MomentPost[]>();
  for (const post of sortPosts(posts)) {
    const date = toShanghaiDate(post.createdAt);
    const items = groups.get(date);
    if (items) items.push(post);
    else groups.set(date, [post]);
  }
  return [...groups].map(([date, items]) => ({ date, items }));
}
