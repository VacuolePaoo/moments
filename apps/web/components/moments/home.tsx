"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { PlusIcon, Trash2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";

import {
  deletePost,
  listPosts,
  restorePost,
  retryRead,
  type MomentPost,
} from "./api";
import { AuthControls, useAdminAccess } from "./auth-controls";
import { Composer } from "./composer";
import { isValidDate, mergePosts } from "./date";
import { Feed } from "./feed";
import { MomentsShell } from "./moments-shell";

function readHashDate(): string | undefined {
  try {
    const value = decodeURIComponent(window.location.hash.slice(1));
    return isValidDate(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function MomentsHome() {
  const { isAdmin, getToken } = useAdminAccess();
  const [posts, setPosts] = useState<MomentPost[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null | undefined>(
    undefined,
  );
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [targetDate, setTargetDate] = useState<string | null>(null);
  const [highlightDate, setHighlightDate] = useState<string | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const scrollCompletedFor = useRef<string | null>(null);

  const loadInitial = useCallback(async (anchorDate?: string) => {
    try {
      let page = await retryRead(() => listPosts({ limit: 20, anchorDate }));
      if (anchorDate && page.items.length === 0) {
        page = await retryRead(() => listPosts({ limit: 20 }));
      }
      setPosts(page.items);
      setNextCursor(page.nextCursor);
      setTargetDate(anchorDate ?? null);
      setError(null);
      scrollCompletedFor.current = null;
    } catch {
      setError("内容加载失败，请稍后重试。");
    } finally {
      setIsInitialLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadInitial(readHashDate()), 0);
    return () => window.clearTimeout(timer);
  }, [loadInitial]);

  useEffect(() => {
    const scrollKey = targetDate
      ? `${targetDate}:${isAdmin ? "admin" : "visitor"}`
      : null;
    if (
      !targetDate ||
      posts.length === 0 ||
      scrollCompletedFor.current === scrollKey
    )
      return;

    const frame = window.requestAnimationFrame(() => {
      const exactTarget = document.getElementById(targetDate);
      const target =
        exactTarget ??
        document.querySelector<HTMLElement>("[data-moment-date]");
      if (!target) return;
      target.scrollIntoView({ block: "start" });
      scrollCompletedFor.current = scrollKey;
      if (exactTarget) setHighlightDate(targetDate);
      window.setTimeout(() => setHighlightDate(null), 1400);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [isAdmin, posts, targetDate]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const page = await retryRead(() =>
        listPosts({ limit: 20, cursor: nextCursor }),
      );
      setPosts((current) => mergePosts(current, page.items));
      setNextCursor(page.nextCursor);
      setError(null);
    } catch {
      setError("更多内容加载失败。");
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore, nextCursor]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !nextCursor || error) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore();
      },
      { rootMargin: "320px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [error, loadMore, nextCursor]);

  function handleCreated(post: MomentPost) {
    setPosts((current) => mergePosts(current, [post]));
  }

  function handleUpdated(post: MomentPost) {
    setPosts((current) => mergePosts(current, [post]));
  }

  async function handleDelete(post: MomentPost) {
    setPosts((current) => current.filter((item) => item.id !== post.id));
    try {
      const token = await getToken();
      if (!token) throw new Error("登录状态已失效。");
      await deletePost(post.id, token);

      const toastId = toast.add({
        title: "已删除",
        timeout: 5000,
        actionProps: {
          children: "撤销",
          onClick: () => {
            void (async () => {
              try {
                const restoreToken = await getToken();
                if (!restoreToken) throw new Error("登录状态已失效。");
                const restored = await restorePost(post.id, restoreToken);
                setPosts((current) => mergePosts(current, [restored]));
                toast.close(toastId);
              } catch {
                toast.add({
                  type: "error",
                  description: "撤销失败，请稍后重试。",
                });
              }
            })();
          },
        },
      });
    } catch {
      setPosts((current) => mergePosts(current, [post]));
      toast.add({ type: "error", description: "删除失败，请稍后重试。" });
    }
  }

  const actions = (
    <div className="flex w-full items-center gap-3 lg:flex-col lg:items-stretch">
      {isAdmin ? (
        <Button
          type="button"
          className="lg:w-full"
          onClick={() => composerRef.current?.focus()}
        >
          <PlusIcon data-icon="inline-start" />
          发布
        </Button>
      ) : null}
      <AuthControls />
      {isAdmin ? (
        <Button
          nativeButton={false}
          render={<Link href="/trash" />}
          variant="ghost"
          className="justify-start"
        >
          <Trash2Icon data-icon="inline-start" />
          回收站
        </Button>
      ) : null}
    </div>
  );

  return (
    <MomentsShell actions={actions}>
      {isAdmin ? (
        <div className="mb-12">
          <Composer
            ref={composerRef}
            getToken={getToken}
            onCreated={handleCreated}
          />
        </div>
      ) : null}

      <Feed
        posts={posts}
        isAdmin={isAdmin}
        getToken={getToken}
        highlightDate={highlightDate}
        isInitialLoading={isInitialLoading}
        isLoadingMore={isLoadingMore}
        error={error}
        onRetry={() => {
          if (posts.length === 0) {
            setIsInitialLoading(true);
            void loadInitial(readHashDate());
          } else {
            void loadMore();
          }
        }}
        onUpdated={handleUpdated}
        onDelete={(post) => void handleDelete(post)}
      />
      <div ref={sentinelRef} className="h-px" aria-hidden="true" />
    </MomentsShell>
  );
}
