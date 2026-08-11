"use client";

import { CornerDownLeftIcon, PencilIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export const FIRST_MOMENT_CONTENT =
  "这是我使用Moments发布的第一篇帖子，它还支持上传图片到我的图床";

export function FirstMomentGuide({
  isLeaving,
  isPublishing,
  onEdit,
  onPublish,
}: {
  isLeaving: boolean;
  isPublishing: boolean;
  onEdit: () => void;
  onPublish: () => void;
}) {
  return (
    <Empty
      className={cn(
        "min-h-[50vh] items-start p-0 text-left text-pretty",
        isLeaving
          ? "animate-out fade-out-0 duration-200"
          : "animate-in fade-in-0 duration-200",
      )}
    >
      <div className="flex w-full max-w-full flex-col items-start gap-4">
        <EmptyHeader className="items-start text-left">
          <EmptyTitle>
            <h3 className="text-[1.602rem] leading-[1.5] font-semibold">
              发布你的第一篇moment
            </h3>
          </EmptyTitle>
          <EmptyDescription className="text-base leading-6">
            你的Moments实例还没有内容
          </EmptyDescription>
        </EmptyHeader>

        <EmptyContent className="max-w-none items-start text-left">
          <div className="flex max-w-full flex-col items-stretch gap-3 sm:flex-row sm:items-center">
            <p className="w-fit max-w-xl text-base leading-6 underline underline-offset-4">
              {FIRST_MOMENT_CONTENT}
            </p>

            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={isPublishing}
                onClick={onEdit}
              >
                <PencilIcon data-icon="inline-start" />
                编辑
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={isPublishing}
                onClick={onPublish}
              >
                {isPublishing ? <Spinner data-icon="inline-start" /> : null}
                发布
                {!isPublishing ? (
                  <CornerDownLeftIcon data-icon="inline-end" />
                ) : null}
              </Button>
            </div>
          </div>
        </EmptyContent>
      </div>
    </Empty>
  );
}
