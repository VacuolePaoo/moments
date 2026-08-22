import {
  getShanghaiDayBounds,
  getShanghaiToday,
  toShanghaiDate,
} from "../lib/date";
import type { Post } from "../schemas";

const RSS_WINDOW_DAYS = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function postTitle(post: Post): string {
  const compact = post.content.replace(/\s+/gu, " ").trim();
  if (compact.length === 0)
    return `图片 Moment（${String(post.images.length)} 张）`;
  const characters = Array.from(compact);
  return characters.length > 60
    ? `${characters.slice(0, 60).join("")}…`
    : compact;
}

function postDescription(post: Post): string {
  return [
    post.content,
    ...post.images.map((image, index) => `图片 ${String(index + 1)}：${image}`),
  ]
    .filter((value) => value.length > 0)
    .join("\n");
}

export function rssWindowBounds(now: Date): { startAt: string; endAt: string } {
  const today = getShanghaiToday(now);
  const { startAt: todayStartAt, endAt } = getShanghaiDayBounds(today);
  return {
    startAt: new Date(
      Date.parse(todayStartAt) - (RSS_WINDOW_DAYS - 1) * DAY_MS,
    ).toISOString(),
    endAt,
  };
}

export function canonicalSiteOrigin(
  configuredOrigin: string | undefined,
  requestUrl: string,
): string {
  try {
    const configured = new URL(configuredOrigin ?? "");
    if (configured.protocol === "https:" || configured.protocol === "http:") {
      return configured.origin;
    }
  } catch {
    // Local or incomplete deployments fall back to the Worker request origin.
  }
  return new URL(requestUrl).origin;
}

export function renderRss(
  posts: Post[],
  siteOrigin: string,
  generatedAt: Date,
  site: { name: string; description: string } = {
    name: "Moments",
    description: "",
  },
): string {
  const siteUrl = `${siteOrigin}/`;
  const feedUrl = `${siteOrigin}/rss.xml`;
  const title = site.name || "Moments";
  const description =
    site.description || `最近${String(RSS_WINDOW_DAYS)}天的${title}`;
  const items = posts
    .map((post) => {
      const date = toShanghaiDate(post.createdAt);
      const link = `${siteOrigin}/p/${date}`;
      return `    <item>
      <title>${escapeXml(postTitle(post))}</title>
      <link>${escapeXml(link)}</link>
      <guid isPermaLink="false">urn:uuid:${escapeXml(post.id)}</guid>
      <pubDate>${new Date(post.createdAt).toUTCString()}</pubDate>
      <description>${escapeXml(postDescription(post))}</description>
    </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(title)}</title>
    <link>${escapeXml(siteUrl)}</link>
    <description>${escapeXml(description)}</description>
    <language>zh-CN</language>
    <lastBuildDate>${generatedAt.toUTCString()}</lastBuildDate>
    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>`;
}
