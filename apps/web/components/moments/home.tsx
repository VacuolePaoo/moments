"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { toast } from "@/components/ui/toast";

import {
  createPost,
  deletePost,
  listPosts,
  restorePost,
  retryRead,
  type MomentPost,
} from "./api";
import { useAdminAccess } from "./auth-controls";
import { Composer } from "./composer";
import { isValidDate, mergePosts } from "./date";
import { Feed } from "./feed";
import { FIRST_MOMENT_CONTENT, FirstMomentGuide } from "./first-moment-guide";
import { MomentsShell } from "./moments-shell";
import { MomentsToolbar } from "./moments-toolbar";
import { PageTitle } from "./page-title";

function readHashDate(): string | undefined {
  try {
    const value = decodeURIComponent(window.location.hash.slice(1));
    return isValidDate(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function MomentsHome() {
  const { isAdmin, isCheckingAdmin, getToken } = useAdminAccess();
  const [posts, setPosts] = useState<MomentPost[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null | undefined>(
    undefined,
  );
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [targetDate, setTargetDate] = useState<string | null>(null);
  const [highlightDate, setHighlightDate] = useState<string | null>(null);
  const [starterDismissed, setStarterDismissed] = useState(false);
  const [starterLeaving, setStarterLeaving] = useState(false);
  const [starterPublishing, setStarterPublishing] = useState(false);
  const [composerInitialContent, setComposerInitialContent] = useState<
    string | undefined
  >();
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

  function finishStarterTransition() {
    return new Promise<void>((resolve) => window.setTimeout(resolve, 180));
  }

  async function editStarterContent() {
    setStarterLeaving(true);
    await finishStarterTransition();
    setComposerInitialContent(FIRST_MOMENT_CONTENT);
    setStarterDismissed(true);
    window.requestAnimationFrame(() => composerRef.current?.focus());
  }

  async function publishStarterContent() {
    if (starterPublishing) return;
    setStarterPublishing(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("登录状态已失效。");
      setStarterLeaving(true);
      const [post] = await Promise.all([
        createPost(FIRST_MOMENT_CONTENT, [], token),
        finishStarterTransition(),
      ]);
      setPosts((current) => mergePosts(current, [post]));
      setStarterDismissed(true);
      setComposerInitialContent(undefined);
    } catch (publishError) {
      setStarterLeaving(false);
      toast.add({
        type: "error",
        description:
          publishError instanceof Error
            ? publishError.message
            : "发布失败，请稍后重试。",
      });
    } finally {
      setStarterPublishing(false);
    }
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

  const hasConfirmedEmpty =
    !isInitialLoading &&
    error === null &&
    posts.length === 0 &&
    nextCursor === null;
  const showStarter =
    hasConfirmedEmpty &&
    !isCheckingAdmin &&
    isAdmin &&
    !starterDismissed;
  const showVisitorEmpty =
    hasConfirmedEmpty && !isCheckingAdmin && !isAdmin;
  const showComposer =
    isAdmin && !isInitialLoading && (!hasConfirmedEmpty || starterDismissed);

  return (
    <MomentsShell
      toolbar={<MomentsToolbar isAdmin={isAdmin} />}
    >
      <PageTitle>Moments</PageTitle>

      {showStarter ? (
        <FirstMomentGuide
          isLeaving={starterLeaving}
          isPublishing={starterPublishing}
          onEdit={() => void editStarterContent()}
          onPublish={() => void publishStarterContent()}
        />
      ) : (
        <div className="animate-in fade-in-0 duration-200">
          {showComposer ? (
            <div className="mb-12">
              <Composer
                ref={composerRef}
                getToken={getToken}
                initialContent={composerInitialContent}
                onCreated={handleCreated}
              />
            </div>
          ) : null}

          {showVisitorEmpty ? (
            <p className="text-base leading-6 text-muted-foreground">
              此实例还没有内容
            </p>
          ) : null}

          <Feed
            posts={posts}
            isAdmin={isAdmin}
            getToken={getToken}
            highlightDate={highlightDate}
            isInitialLoading={isInitialLoading}
            isLoadingMore={isLoadingMore}
            showEmptyMessage={false}
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
        </div>
      )}
      <div ref={sentinelRef} className="h-px" aria-hidden="true" />
    </MomentsShell>
  );
}
