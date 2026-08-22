"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { toast } from "@/components/ui/toast";
import { TransitionPresence } from "@/components/ui/transition-presence";

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
import { readCachedHomeFeed, writeCachedHomeFeed } from "./feed-cache";
import { FIRST_MOMENT_CONTENT, FirstMomentGuide } from "./first-moment-guide";
import { MomentsShell } from "./moments-shell";
import { PageTitle } from "./page-title";
import { useSiteSettings } from "./site-settings";

let pendingHomeRequest: {
  key: string;
  promise: ReturnType<typeof listPosts>;
} | null = null;

function loadLatestHomeFeed(limit: number, token?: string) {
  const key = `${String(limit)}:${token ? "private" : "public"}`;
  if (!pendingHomeRequest || pendingHomeRequest.key !== key) {
    const promise = retryRead(() => listPosts({ limit }, token)).finally(() => {
      if (pendingHomeRequest?.promise === promise) pendingHomeRequest = null;
    });
    pendingHomeRequest = { key, promise };
  }
  return pendingHomeRequest.promise;
}

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
  const { settings, isLoading: isSettingsLoading } = useSiteSettings();
  const [posts, setPosts] = useState<MomentPost[]>(
    () => readCachedHomeFeed()?.posts ?? [],
  );
  const [nextCursor, setNextCursor] = useState<string | null | undefined>(
    () => readCachedHomeFeed()?.nextCursor,
  );
  const [isInitialLoading, setIsInitialLoading] = useState(
    () => readCachedHomeFeed() === null,
  );
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
  const [focusComposerWhenReady, setFocusComposerWhenReady] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const scrollCompletedFor = useRef<string | null>(null);
  const contentRevision = useRef(0);

  const pageSize = settings?.content.pageSize ?? 20;
  const contentRequiresAdmin = settings?.content.public === false;

  const loadInitial = useCallback(async (anchorDate?: string, token?: string) => {
    const revisionAtStart = contentRevision.current;
    const isBackgroundRefresh = !anchorDate && readCachedHomeFeed() !== null;
    try {
      let page = anchorDate
        ? await retryRead(() =>
            listPosts({ limit: pageSize, anchorDate }, token),
          )
        : await loadLatestHomeFeed(pageSize, token);
      if (anchorDate && page.items.length === 0) {
        page = await loadLatestHomeFeed(pageSize, token);
      }

      // A publish/edit/delete completed while the refresh was in flight. Its
      // local result is newer than this response, so keep it until next refresh.
      if (contentRevision.current !== revisionAtStart) return;

      setPosts(page.items);
      setNextCursor(page.nextCursor);
      setTargetDate(anchorDate ?? null);
      setError(null);
      scrollCompletedFor.current = null;
      if (!anchorDate) {
        writeCachedHomeFeed({
          posts: page.items,
          nextCursor: page.nextCursor,
        });
      }
    } catch {
      if (!isBackgroundRefresh || anchorDate) {
        setError("内容加载失败，请稍后重试。");
      }
    } finally {
      setIsInitialLoading(false);
    }
  }, [pageSize]);

  useEffect(() => {
    if (isSettingsLoading) return;
    if (!settings) {
      const timer = window.setTimeout(() => {
        setIsInitialLoading(false);
        setError("站点配置加载失败，请稍后重试。");
      }, 0);
      return () => window.clearTimeout(timer);
    }
    if (contentRequiresAdmin && isCheckingAdmin) return;
    if (contentRequiresAdmin && !isAdmin) {
      const timer = window.setTimeout(() => {
        setPosts([]);
        setNextCursor(null);
        setIsInitialLoading(false);
        setError(null);
      }, 0);
      return () => window.clearTimeout(timer);
    }

    let cancelled = false;
    const anchorDate = readHashDate();
    void (async () => {
      const token = contentRequiresAdmin ? await getToken() : undefined;
      if (contentRequiresAdmin && !token) {
        if (!cancelled) {
          setIsInitialLoading(false);
          setError("登录状态已失效。");
        }
        return;
      }
      if (!cancelled) await loadInitial(anchorDate, token ?? undefined);
    })();
    return () => {
      cancelled = true;
    };
  }, [
    contentRequiresAdmin,
    getToken,
    isAdmin,
    isCheckingAdmin,
    isSettingsLoading,
    loadInitial,
    settings,
  ]);

  useEffect(() => {
    if (isInitialLoading || targetDate !== null || nextCursor === undefined)
      return;
    writeCachedHomeFeed({ posts, nextCursor });
  }, [isInitialLoading, nextCursor, posts, targetDate]);

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
      const token = contentRequiresAdmin ? await getToken() : undefined;
      if (contentRequiresAdmin && !token) {
        throw new Error("登录状态已失效。");
      }
      const page = await retryRead(() =>
        listPosts(
          { limit: pageSize, cursor: nextCursor },
          token ?? undefined,
        ),
      );
      setPosts((current) => mergePosts(current, page.items));
      setNextCursor(page.nextCursor);
      setError(null);
    } catch {
      setError("更多内容加载失败。");
    } finally {
      setIsLoadingMore(false);
    }
  }, [contentRequiresAdmin, getToken, isLoadingMore, nextCursor, pageSize]);

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
    contentRevision.current += 1;
    setPosts((current) => mergePosts(current, [post]));
  }

  function finishStarterTransition() {
    return new Promise<void>((resolve) => window.setTimeout(resolve, 180));
  }

  async function editStarterContent() {
    setStarterLeaving(true);
    await finishStarterTransition();
    setComposerInitialContent(FIRST_MOMENT_CONTENT);
    setFocusComposerWhenReady(true);
    setStarterDismissed(true);
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
      contentRevision.current += 1;
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
    contentRevision.current += 1;
    setPosts((current) => mergePosts(current, [post]));
  }

  async function handleDelete(post: MomentPost) {
    contentRevision.current += 1;
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
                contentRevision.current += 1;
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
      contentRevision.current += 1;
      setPosts((current) => mergePosts(current, [post]));
      toast.add({ type: "error", description: "删除失败，请稍后重试。" });
    }
  }

  const hasConfirmedEmpty =
    !isInitialLoading &&
    !isSettingsLoading &&
    error === null &&
    posts.length === 0 &&
    nextCursor === null;
  const accessChecking = contentRequiresAdmin && isCheckingAdmin;
  const accessRestricted =
    contentRequiresAdmin && !isCheckingAdmin && !isAdmin;
  const showStarter =
    hasConfirmedEmpty && !isCheckingAdmin && isAdmin && !starterDismissed;
  const showVisitorEmpty =
    hasConfirmedEmpty && !accessRestricted && !isCheckingAdmin && !isAdmin;
  const showComposer =
    isAdmin && !isInitialLoading && (!hasConfirmedEmpty || starterDismissed);

  useEffect(() => {
    if (!focusComposerWhenReady || !showComposer) return;
    let frame = 0;
    let attempts = 0;
    const focusAfterMount = () => {
      const composer =
        composerRef.current ??
        document.querySelector<HTMLTextAreaElement>("#moment-composer");
      if (composer && !composer.closest("[inert]")) {
        composer.focus({ preventScroll: true });
      }
      if (composer && document.activeElement === composer) {
        setFocusComposerWhenReady(false);
        return;
      }
      attempts += 1;
      if (attempts < 30) {
        frame = window.requestAnimationFrame(focusAfterMount);
      }
    };
    frame = window.requestAnimationFrame(focusAfterMount);
    return () => window.cancelAnimationFrame(frame);
  }, [focusComposerWhenReady, showComposer]);

  useEffect(() => {
    const startComposer = () => {
      if (!showStarter) {
        window.requestAnimationFrame(() => composerRef.current?.focus());
        return;
      }
      void (async () => {
        setStarterLeaving(true);
        await finishStarterTransition();
        setComposerInitialContent(undefined);
        setFocusComposerWhenReady(true);
        setStarterDismissed(true);
      })();
    };
    window.addEventListener("moments:start-composer", startComposer);
    return () =>
      window.removeEventListener("moments:start-composer", startComposer);
  }, [showStarter]);

  const showSiteName = settings?.site.showName === true;
  const siteDescription = settings?.site.description ?? "";
  const visiblePosts =
    isSettingsLoading || !settings || accessChecking || accessRestricted
      ? []
      : posts;

  return (
    <MomentsShell>
      <div className="mx-auto w-full max-w-[640px]">
        {showSiteName || siteDescription ? (
          <header className="mb-12 flex flex-col gap-2">
            {showSiteName ? (
              <PageTitle className="mb-0">
                {settings?.site.name || "Moments"}
              </PageTitle>
            ) : null}
            {siteDescription ? (
              <p className="text-base leading-6 text-muted-foreground">
                {siteDescription}
              </p>
            ) : null}
          </header>
        ) : null}

        <div className="grid">
          <TransitionPresence
            show={showStarter}
            className="col-start-1 row-start-1 min-w-0 max-w-full"
          >
            <FirstMomentGuide
              isLeaving={starterLeaving}
              isPublishing={starterPublishing}
              onEdit={() => void editStarterContent()}
              onPublish={() => void publishStarterContent()}
            />
          </TransitionPresence>

          <TransitionPresence
            show={!showStarter}
            className="col-start-1 row-start-1 min-w-0 max-w-full"
          >
            <div>
              <TransitionPresence show={showComposer} collapse>
                <div className="mb-12">
                  <Composer
                    ref={composerRef}
                    getToken={getToken}
                    initialContent={composerInitialContent}
                    onCreated={handleCreated}
                  />
                </div>
              </TransitionPresence>

              <TransitionPresence show={showVisitorEmpty}>
                <p className="text-base leading-6 text-muted-foreground">
                  此实例还没有内容
                </p>
              </TransitionPresence>

              <TransitionPresence show={accessRestricted}>
                <p className="text-base leading-6 text-muted-foreground">
                  当前内容未公开
                </p>
              </TransitionPresence>

              <Feed
                posts={visiblePosts}
                isAdmin={isAdmin}
                getToken={getToken}
                highlightDate={highlightDate}
                isInitialLoading={
                  isInitialLoading || isSettingsLoading || accessChecking
                }
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
          </TransitionPresence>
        </div>
        <div ref={sentinelRef} className="h-px" aria-hidden="true" />
      </div>
    </MomentsShell>
  );
}
