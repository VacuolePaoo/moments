import { RefreshCwIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";

import type { DateDetail } from "./api";
import { formatDateHeading } from "./date";
import { MomentReadOnly } from "./moment-item";

export function RandomMomentDialog({
  detail,
  isRefreshing,
  open,
  onOpenChange,
  onRequestAnother,
}: {
  detail: DateDetail;
  isRefreshing: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRequestAnother: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="w-full gap-4 bg-transparent p-0 ring-0 sm:max-w-[640px]"
      >
        <DialogTitle className="text-[1.602rem] leading-[1.5] font-semibold">
          {formatDateHeading(detail.date)}
        </DialogTitle>
        <DialogDescription className="sr-only">
          随机展示一个日期及当天发布的全部 Moment。
        </DialogDescription>

        <Card className="py-0">
          <CardContent className="px-0">
            <ScrollArea className="h-[min(60dvh,32rem)]">
              <div className="p-4">
                {detail.items.map((post, index) => (
                  <div key={post.id}>
                    {index > 0 ? <Separator className="my-6" /> : null}
                    <MomentReadOnly
                      post={post}
                      showTime={detail.items.length > 1}
                      eagerImages={index === 0}
                    />
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <div className="flex items-center justify-center gap-2">
          <Button
            type="button"
            disabled={isRefreshing}
            onClick={onRequestAnother}
          >
            {isRefreshing ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <RefreshCwIcon data-icon="inline-start" />
            )}
            {isRefreshing ? "获取中" : "换一天"}
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
