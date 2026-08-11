"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCwIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

import {
  getRandomMomentDate,
  MomentsApiError,
  retryRead,
  type DateDetail,
} from "./api";
import { formatDateHeading } from "./date";
import { MomentImages } from "./image-attachments";
import { TextContent } from "./text-content";

export function RandomMomentDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [detail, setDetail] = useState<DateDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const value = await retryRead(() => getRandomMomentDate());
      setDetail(value);
      setError(null);
    } catch (loadError) {
      setDetail(null);
      setError(
        loadError instanceof MomentsApiError && loadError.status === 404
          ? "还没有可随机展示的内容"
          : "随机内容加载失败，请稍后重试。",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open || detail || isLoading || error) return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [detail, error, isLoading, load, open]);

  function changeOpen(nextOpen: boolean) {
    onOpenChange(nextOpen);
    if (!nextOpen) {
      setDetail(null);
      setError(null);
      setIsLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent
        showCloseButton={false}
        className="w-full gap-4 bg-transparent p-0 ring-0 sm:max-w-xl"
      >
        <DialogTitle className="sr-only">随机 Moment</DialogTitle>
        <DialogDescription className="sr-only">
          随机展示一个日期及当天发布的全部 Moment。
        </DialogDescription>

        <Card>
          <CardHeader>
            <CardTitle className="text-[1.602rem] leading-[1.5] font-semibold">
              {detail ? formatDateHeading(detail.date) : "随机 Moment"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? <RandomMomentSkeleton /> : null}
            {!isLoading && error ? (
              <p className="text-base leading-6 text-muted-foreground">
                {error}
              </p>
            ) : null}
            {!isLoading && detail ? (
              <ScrollArea className="max-h-[min(60vh,32rem)] pr-3">
                <div>
                  {detail.items.map((post, index) => (
                    <div key={post.id}>
                      {index > 0 ? <Separator className="my-6" /> : null}
                      <article className="flex min-w-0 flex-col gap-4">
                        <MomentImages images={post.images} />
                        {post.content ? (
                          <TextContent content={post.content} />
                        ) : null}
                      </article>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            ) : null}
          </CardContent>
        </Card>

        <div className="flex items-center justify-center gap-2">
          <Button
            type="button"
            disabled={isLoading}
            onClick={() => void load()}
          >
            <RefreshCwIcon data-icon="inline-start" />
            换一天
          </Button>
          <DialogClose render={<Button type="button" variant="outline" />}>
            <XIcon data-icon="inline-start" />
            关闭
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RandomMomentSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-label="正在加载随机 Moment">
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-4/5" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  );
}
