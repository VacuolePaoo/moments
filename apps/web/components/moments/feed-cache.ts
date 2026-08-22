import type { DateDetail, MomentPost } from "./api";
import { groupPostsByDate, sortPosts, toShanghaiDate } from "./date";

export interface CachedHomeFeed {
  posts: MomentPost[];
  nextCursor: string | null;
}

let cachedHomeFeed: CachedHomeFeed | null = null;

export function readCachedHomeFeed(): CachedHomeFeed | null {
  return cachedHomeFeed;
}

export function writeCachedHomeFeed(feed: CachedHomeFeed): void {
  cachedHomeFeed = feed;
}

export function clearCachedHomeFeed(): void {
  cachedHomeFeed = null;
}

export function readCachedDateDetail(date: string): DateDetail | null {
  if (!cachedHomeFeed) return null;

  const groups = groupPostsByDate(cachedHomeFeed.posts);
  const index = groups.findIndex((group) => group.date === date);
  if (index === -1) return null;

  return {
    date,
    items: groups[index].items,
    navigation: {
      newerDate: groups[index - 1]?.date ?? null,
      olderDate: groups[index + 1]?.date ?? null,
    },
  };
}

export function replaceCachedDatePosts(
  date: string,
  posts: MomentPost[],
): void {
  if (!cachedHomeFeed) return;
  cachedHomeFeed = {
    ...cachedHomeFeed,
    posts: sortPosts([
      ...cachedHomeFeed.posts.filter(
        (post) => toShanghaiDate(post.createdAt) !== date,
      ),
      ...posts,
    ]),
  };
}

export function updateCachedPost(post: MomentPost): void {
  if (!cachedHomeFeed) return;
  cachedHomeFeed = {
    ...cachedHomeFeed,
    posts: sortPosts([
      ...cachedHomeFeed.posts.filter((item) => item.id !== post.id),
      post,
    ]),
  };
}

export function removeCachedPost(id: string): void {
  if (!cachedHomeFeed) return;
  cachedHomeFeed = {
    ...cachedHomeFeed,
    posts: cachedHomeFeed.posts.filter((post) => post.id !== id),
  };
}
