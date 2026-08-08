"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

import type { MomentPost } from "./api";
import { formatDateHeading, groupPostsByDate } from "./date";
import { MomentItem } from "./moment-item";

interface FeedProps {
  posts: MomentPost[];
  isAdmin: boolean;
  getToken: () => Promise<string | null>;
  showEdited?: boolean;
  highlightDate?: string | null;
  isInitialLoading?: boolean;
  isLoadingMore?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onUpdated: (post: MomentPost) => void;
  onDelete: (post: MomentPost) => void;
}

export function Feed({
  posts,
  isAdmin,
  getToken,
  showEdited = false,
  highlightDate,
  isInitialLoading = false,
  isLoadingMore = false,
  error,
  onRetry,
  onUpdated,
  onDelete,
}: FeedProps) {
  if (isInitialLoading) return <FeedSkeleton />;

  if (error && posts.length === 0) {
    return <FeedError message={error} onRetry={onRetry} />;
  }

  if (posts.length === 0) {
    return <p className="text-muted-foreground">还没有内容</p>;
  }

  const groups = groupPostsByDate(posts);

  return (
    <div>
      <div className="space-y-12">
        {groups.map((group, groupIndex) => (
          <section key={group.date} aria-labelledby={`heading-${group.date}`}>
            <h2
              id={group.date}
              data-moment-date={group.date}
              className={`mb-6 scroll-mt-8 w-fit rounded-md text-[1.602rem] leading-[1.5] font-semibold transition-colors ${
                highlightDate === group.date
                  ? "animate-in bg-muted px-2 fade-in-0 duration-700 -ml-2"
                  : ""
              }`}
            >
              <Link
                id={`heading-${group.date}`}
                href={`/p/${group.date}`}
                className="cursor-pointer hover:opacity-70"
              >
                {formatDateHeading(group.date)}
              </Link>
            </h2>
            <div>
              {group.items.map((post, index) => (
                <div key={post.id}>
                  {index > 0 ? <Separator className="my-6" /> : null}
                  <MomentItem
                    post={post}
                    isAdmin={isAdmin}
                    getToken={getToken}
                    showEdited={showEdited}
                    eagerImages={groupIndex === 0 && index === 0}
                    onUpdated={onUpdated}
                    onDelete={onDelete}
                  />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      {error ? (
        <FeedError message={error} onRetry={onRetry} className="mt-12" />
      ) : null}
      {isLoadingMore ? <FeedSkeleton className="mt-12" /> : null}
    </div>
  );
}

export function FeedSkeleton({ className = "" }: { className?: string }) {
  return (
    <div className={`space-y-4 ${className}`} aria-label="正在加载内容">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-4/5" />
    </div>
  );
}

function FeedError({
  message,
  onRetry,
  className = "",
}: {
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-3 ${className}`} role="alert">
      <p className="text-sm text-muted-foreground">{message}</p>
      {onRetry ? (
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          重试
        </Button>
      ) : null}
    </div>
  );
}
