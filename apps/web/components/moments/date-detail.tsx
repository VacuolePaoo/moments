"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/components/ui/toast";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import {
  deletePost,
  getDateDetail,
  MomentsApiError,
  restorePost,
  retryRead,
  type DateDetail,
  type MomentPost,
} from "./api";
import { useAdminAccess } from "./auth-controls";
import { formatDateHeading, mergePosts } from "./date";
import { FeedSkeleton } from "./feed";
import { MomentItem } from "./moment-item";
import { MomentsShell } from "./moments-shell";

export function MomentDateDetail({ date }: { date: string }) {
  const router = useRouter();
  const { isAdmin, getToken } = useAdminAccess();
  const [detail, setDetail] = useState<DateDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const value = await retryRead(() => getDateDetail(date));
      setDetail(value);
      setNotFound(false);
      setError(null);
    } catch (loadError) {
      if (loadError instanceof MomentsApiError && loadError.status === 404) {
        setNotFound(true);
        setError(null);
      } else {
        setError("内容加载失败，请稍后重试。");
      }
    } finally {
      setIsLoading(false);
    }
  }, [date]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  function handleUpdated(post: MomentPost) {
    setDetail((current) =>
      current
        ? { ...current, items: mergePosts(current.items, [post]) }
        : current,
    );
  }

  async function handleDelete(post: MomentPost) {
    const wasLast = detail?.items.length === 1;
    setDetail((current) =>
      current
        ? {
            ...current,
            items: current.items.filter((item) => item.id !== post.id),
          }
        : current,
    );

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
                toast.close(toastId);
                if (wasLast) {
                  router.push(`/p/${date}`);
                } else {
                  setDetail((current) =>
                    current
                      ? {
                          ...current,
                          items: mergePosts(current.items, [restored]),
                        }
                      : current,
                  );
                }
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

      if (wasLast) router.push(`/#${date}`);
    } catch {
      setDetail((current) =>
        current
          ? { ...current, items: mergePosts(current.items, [post]) }
          : current,
      );
      toast.add({ type: "error", description: "删除失败，请稍后重试。" });
    }
  }

  return (
    <MomentsShell>
      {isLoading ? <FeedSkeleton /> : null}

      {!isLoading && error ? (
        <div className="flex items-center gap-3" role="alert">
          <p className="text-base leading-6 text-muted-foreground">{error}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setIsLoading(true);
              void load();
            }}
          >
            重试
          </Button>
        </div>
      ) : null}

      {!isLoading && notFound ? (
        <div>
          <p className="text-base leading-6 text-muted-foreground">
            当天没有内容
          </p>
          <Link
            href={`/#${date}`}
            className={buttonVariants({
              variant: "link",
              className: "mt-4 px-0",
            })}
          >
            返回
          </Link>
        </div>
      ) : null}

      {!isLoading && detail ? (
        <>
          <header className="mb-6 flex items-start justify-between gap-4">
            <h2 className="text-[1.602rem] leading-[1.5] font-semibold">
              {formatDateHeading(detail.date)}
            </h2>
            <DateNavigation detail={detail} />
          </header>

          <div>
            {detail.items.map((post, index) => (
              <div key={post.id}>
                {index > 0 ? <Separator className="my-6" /> : null}
                <MomentItem
                  post={post}
                  isAdmin={isAdmin}
                  getToken={getToken}
                  showTime={detail.items.length > 1}
                  showEdited
                  eagerImages={index === 0}
                  onUpdated={handleUpdated}
                  onDelete={(item) => void handleDelete(item)}
                />
              </div>
            ))}
          </div>
        </>
      ) : null}
    </MomentsShell>
  );
}

function DateNavigation({ detail }: { detail: DateDetail }) {
  return (
    <ButtonGroup aria-label="日期翻页" className="shrink-0">
      <Tooltip>
        <TooltipTrigger
          render={
            detail.navigation.newerDate ? (
              <Link
                href={`/p/${detail.navigation.newerDate}`}
                aria-label="上一条"
                data-slot="button"
                className={buttonVariants({ variant: "outline", size: "icon" })}
              />
            ) : (
              <span
                role="button"
                aria-label="上一条"
                aria-disabled="true"
                tabIndex={0}
                data-slot="button"
                className={buttonVariants({
                  variant: "outline",
                  size: "icon",
                  className: "cursor-default opacity-50",
                })}
              />
            )
          }
        >
          <ChevronLeftIcon />
        </TooltipTrigger>
        <TooltipContent>上一条</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger
          render={
            detail.navigation.olderDate ? (
              <Link
                href={`/p/${detail.navigation.olderDate}`}
                aria-label="下一条"
                data-slot="button"
                className={buttonVariants({ variant: "outline", size: "icon" })}
              />
            ) : (
              <span
                role="button"
                aria-label="下一条"
                aria-disabled="true"
                tabIndex={0}
                data-slot="button"
                className={buttonVariants({
                  variant: "outline",
                  size: "icon",
                  className: "cursor-default opacity-50",
                })}
              />
            )
          }
        >
          <ChevronRightIcon />
        </TooltipTrigger>
        <TooltipContent>下一条</TooltipContent>
      </Tooltip>
    </ButtonGroup>
  );
}
