"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RotateCcwIcon, Trash2Icon } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { TransitionPresence } from "@/components/ui/transition-presence";

import {
  listDeletedPosts,
  permanentlyDeletePost,
  restorePost,
  retryRead,
  type DeletedMomentPost,
} from "./api";
import { useAdminAccess } from "./auth-controls";
import { FeedSkeleton } from "./feed";
import { MomentImages } from "./image-attachments";
import { MomentsShell } from "./moments-shell";
import { PageTitle } from "./page-title";
import { TextContent } from "./text-content";

const dateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function MomentsTrash() {
  const { isAdmin, isCheckingAdmin, getToken } = useAdminAccess();
  const [posts, setPosts] = useState<DeletedMomentPost[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null | undefined>();
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const loadInitial = useCallback(async () => {
    setIsLoading(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("登录状态已失效。");
      const page = await retryRead(() => listDeletedPosts(token));
      setPosts(page.items);
      setNextCursor(page.nextCursor);
      setError(null);
    } catch {
      setError("回收站加载失败，请稍后重试。");
    } finally {
      setIsLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    if (isCheckingAdmin) return;
    if (!isAdmin) return;
    const timer = window.setTimeout(() => void loadInitial(), 0);
    return () => window.clearTimeout(timer);
  }, [isAdmin, isCheckingAdmin, loadInitial]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("登录状态已失效。");
      const page = await retryRead(() =>
        listDeletedPosts(token, { cursor: nextCursor }),
      );
      setPosts((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
      setError(null);
    } catch {
      setError("更多已删除内容加载失败。");
    } finally {
      setIsLoadingMore(false);
    }
  }, [getToken, isLoadingMore, nextCursor]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !nextCursor || error || !isAdmin) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore();
      },
      { rootMargin: "320px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [error, isAdmin, loadMore, nextCursor]);

  async function handleRestore(post: DeletedMomentPost) {
    setPendingId(post.id);
    try {
      const token = await getToken();
      if (!token) throw new Error("登录状态已失效。");
      await restorePost(post.id, token);
      setPosts((current) => current.filter((item) => item.id !== post.id));
      toast.add({ description: "已恢复。" });
    } catch {
      toast.add({ type: "error", description: "恢复失败，请稍后重试。" });
    } finally {
      setPendingId(null);
    }
  }

  async function handlePermanentDelete(post: DeletedMomentPost) {
    setPendingId(post.id);
    try {
      const token = await getToken();
      if (!token) throw new Error("登录状态已失效。");
      await permanentlyDeletePost(post.id, token);
      setPosts((current) => current.filter((item) => item.id !== post.id));
      toast.add({ description: "已永久删除。" });
    } catch {
      toast.add({ type: "error", description: "永久删除失败，请稍后重试。" });
    } finally {
      setPendingId(null);
    }
  }

  return (
    <MomentsShell>
      <div className="mx-auto w-full max-w-[640px]">
        <PageTitle>回收站</PageTitle>
        <div className="grid [&>*]:col-start-1 [&>*]:row-start-1">
          <TransitionPresence
            show={isCheckingAdmin || (isAdmin && isLoading)}
            className="min-w-0 max-w-full !translate-y-0 !scale-100"
          >
            <FeedSkeleton />
          </TransitionPresence>

          <TransitionPresence
            show={!isCheckingAdmin && !isAdmin}
            className="min-w-0 max-w-full !translate-y-0 !scale-100"
          >
            <p className="text-base leading-6 text-muted-foreground">
              请使用管理员账号登录
            </p>
          </TransitionPresence>

          <TransitionPresence
            show={isAdmin && !isLoading && Boolean(error) && posts.length === 0}
            className="min-w-0 max-w-full !translate-y-0 !scale-100"
          >
            <div className="flex items-center gap-3" role="alert">
              <p className="text-base leading-6 text-muted-foreground">
                {error}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={loadInitial}
              >
                重试
              </Button>
            </div>
          </TransitionPresence>

          <TransitionPresence
            show={isAdmin && !isLoading && !error && posts.length === 0}
            className="min-w-0 max-w-full !translate-y-0 !scale-100"
          >
            <p className="text-base leading-6 text-muted-foreground">
              回收站是空的
            </p>
          </TransitionPresence>

          <TransitionPresence
            show={isAdmin && !isLoading && posts.length > 0}
            className="min-w-0 max-w-full !translate-y-0 !scale-100"
          >
            <div>
              {posts.map((post, index) => (
                <div key={post.id}>
                  {index > 0 ? <Separator className="my-6" /> : null}
                  <TrashItem
                    post={post}
                    pending={pendingId === post.id}
                    onRestore={() => void handleRestore(post)}
                    onPermanentDelete={() => void handlePermanentDelete(post)}
                  />
                </div>
              ))}
              {error ? (
                <div className="mt-12 flex items-center gap-3" role="alert">
                  <p className="text-base leading-6 text-muted-foreground">
                    {error}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={loadMore}
                  >
                    重试
                  </Button>
                </div>
              ) : null}
              {isLoadingMore ? <FeedSkeleton className="mt-12" /> : null}
            </div>
          </TransitionPresence>
        </div>
        <div ref={sentinelRef} className="h-px" aria-hidden="true" />
      </div>
    </MomentsShell>
  );
}

function TrashItem({
  post,
  pending,
  onRestore,
  onPermanentDelete,
}: {
  post: DeletedMomentPost;
  pending: boolean;
  onRestore: () => void;
  onPermanentDelete: () => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <article className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <p>
            创建于{" "}
            <time dateTime={post.createdAt}>
              {dateTimeFormatter.format(new Date(post.createdAt))}
            </time>
          </p>
          <p>
            删除于{" "}
            <time dateTime={post.deletedAt}>
              {dateTimeFormatter.format(new Date(post.deletedAt))}
            </time>
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={onRestore}
          >
            {pending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <RotateCcwIcon data-icon="inline-start" />
            )}
            恢复
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={pending}
            onClick={() => setConfirmOpen(true)}
          >
            <Trash2Icon data-icon="inline-start" />
            永久删除
          </Button>
        </div>
      </div>
      <MomentImages images={post.images} />
      {post.content ? <TextContent content={post.content} /> : null}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>永久删除这条说说？</AlertDialogTitle>
            <AlertDialogDescription>
              此操作无法撤销，已上传到图床的图片也会同时删除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={onPermanentDelete}
            >
              永久删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  );
}
