"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Button, buttonVariants } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";

import {
  deletePost,
  getPost,
  MomentsApiError,
  restorePost,
  retryRead,
  type MomentPost,
} from "./api";
import { useAdminAccess } from "./auth-controls";
import { FeedSkeleton } from "./feed";
import {
  readCachedPost,
  removeCachedPost,
  updateCachedPost,
} from "./feed-cache";
import { MomentItem } from "./moment-item";
import { MomentsShell } from "./moments-shell";
import { useSiteSettings } from "./site-settings";

export function MomentPostDetail({ id }: { id: string }) {
  const router = useRouter();
  const { isAdmin, isCheckingAdmin, getToken } = useAdminAccess();
  const { settings, isLoading: isSettingsLoading } = useSiteSettings();
  const [initialPost] = useState(() => readCachedPost(id));
  const [post, setPost] = useState<MomentPost | null>(initialPost);
  const [isLoading, setIsLoading] = useState(initialPost === null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const contentRequiresAdmin = settings?.content.public === false;
  const accessChecking = contentRequiresAdmin && isCheckingAdmin;
  const accessRestricted = contentRequiresAdmin && !isCheckingAdmin && !isAdmin;

  const load = useCallback(async (token?: string) => {
    try {
      const value = await retryRead(() => getPost(id, undefined, token));
      setPost(value.post);
      updateCachedPost(value.post);
      setNotFound(false);
      setError(null);
    } catch (loadError) {
      if (loadError instanceof MomentsApiError && loadError.status === 404) {
        setPost(null);
        removeCachedPost(id);
        setNotFound(true);
        setError(null);
      } else if (!initialPost) {
        setError("内容加载失败，请稍后重试。");
      }
    } finally {
      setIsLoading(false);
    }
  }, [id, initialPost]);

  useEffect(() => {
    if (isSettingsLoading || !settings) return;
    if (contentRequiresAdmin && isCheckingAdmin) return;
    if (accessRestricted) {
      const timer = window.setTimeout(() => {
        setPost(null);
        setIsLoading(false);
        setError(null);
      }, 0);
      return () => window.clearTimeout(timer);
    }
    let cancelled = false;
    void (async () => {
      const token = contentRequiresAdmin ? await getToken() : undefined;
      if (!cancelled) void load(token ?? undefined);
    })();
    return () => {
      cancelled = true;
    };
  }, [
    accessRestricted,
    contentRequiresAdmin,
    getToken,
    isCheckingAdmin,
    isSettingsLoading,
    load,
    settings,
  ]);

  function handleUpdated(updated: MomentPost) {
    updateCachedPost(updated);
    setPost(updated);
  }

  async function handleDelete(deleted: MomentPost) {
    removeCachedPost(deleted.id);
    setPost(null);

    try {
      const token = await getToken();
      if (!token) throw new Error("登录状态已失效。");
      await deletePost(deleted.id, token);

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
                const restored = await restorePost(deleted.id, restoreToken);
                updateCachedPost(restored);
                toast.close(toastId);
                setPost(restored);
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

      router.push("/");
    } catch {
      updateCachedPost(deleted);
      setPost(deleted);
      toast.add({ type: "error", description: "删除失败，请稍后重试。" });
    }
  }

  return (
    <MomentsShell>
      <div className="mx-auto w-full max-w-[640px]">
        {isLoading || isSettingsLoading || accessChecking ? (
          <FeedSkeleton />
        ) : null}

        {!isSettingsLoading && accessRestricted ? (
          <p className="text-base leading-6 text-muted-foreground">
            当前内容未公开
          </p>
        ) : null}

        {!isLoading && !accessRestricted && error ? (
          <div className="flex items-center gap-3" role="alert">
            <p className="text-base leading-6 text-muted-foreground">{error}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setIsLoading(true);
                void (async () => {
                  const token = contentRequiresAdmin
                    ? await getToken()
                    : undefined;
                  await load(token ?? undefined);
                })();
              }}
            >
              重试
            </Button>
          </div>
        ) : null}

        {!isLoading && !accessRestricted && notFound ? (
          <div>
            <p className="text-base leading-6 text-muted-foreground">
              内容不存在或已删除
            </p>
            <Link
              href="/"
              className={buttonVariants({
                variant: "link",
                className: "mt-4 px-0",
              })}
            >
              返回
            </Link>
          </div>
        ) : null}

        {!isLoading && !accessRestricted && post ? (
          <>
            <header className="mb-6">
              <h2 className="text-[1.602rem] leading-[1.5] font-semibold">
                分享给你的moment
              </h2>
            </header>

            <MomentItem
              post={post}
              isAdmin={isAdmin}
              getToken={getToken}
              showTime
              showEdited
              eagerImages
              onUpdated={handleUpdated}
              onDelete={(item) => void handleDelete(item)}
            />
          </>
        ) : null}
      </div>
    </MomentsShell>
  );
}
