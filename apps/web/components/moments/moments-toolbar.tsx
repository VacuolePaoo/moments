"use client";

import { useRouter } from "next/navigation";
import { useState, type ComponentType, type SVGProps } from "react";
import {
  CalendarDaysIcon,
  DicesIcon,
  HouseIcon,
  SettingsIcon,
  Trash2Icon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { toast } from "@/components/ui/toast";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { TransitionPresence } from "@/components/ui/transition-presence";

import { AuthControls, useAdminAccess } from "./auth-controls";
import {
  getRandomMomentDate,
  MomentsApiError,
  retryRead,
  type DateDetail,
} from "./api";
import { RandomMomentDialog } from "./random-moment-dialog";

type ToolbarIcon = ComponentType<SVGProps<SVGSVGElement>>;

function ToolbarButton({
  label,
  icon: Icon,
  onClick,
  reserved = false,
  disabled = false,
}: {
  label: string;
  icon: ToolbarIcon;
  onClick?: () => void;
  reserved?: boolean;
  disabled?: boolean;
}) {
  return (
    <span className="inline-flex">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-lg"
              className="rounded-full"
              aria-label={label}
              aria-disabled={reserved || onClick === undefined}
              disabled={disabled}
              onClick={onClick}
            />
          }
        >
          <Icon />
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </span>
  );
}

export function MomentsToolbar() {
  const router = useRouter();
  const { isAdmin, isCheckingAdmin } = useAdminAccess();
  const [randomOpen, setRandomOpen] = useState(false);
  const [randomDetail, setRandomDetail] = useState<DateDetail | null>(null);
  const [isRandomLoading, setIsRandomLoading] = useState(false);
  const openHome = () => router.push("/");
  const openStatistics = () => router.push("/statistics");
  const openTrash = () => router.push("/trash");

  async function loadRandom(openWhenReady: boolean) {
    if (isRandomLoading) return;
    setIsRandomLoading(true);
    try {
      const detail = await retryRead(() => getRandomMomentDate());
      setRandomDetail(detail);
      if (openWhenReady) setRandomOpen(true);
    } catch (error) {
      toast.add({
        type: "error",
        description:
          error instanceof MomentsApiError && error.status === 404
            ? "还没有可随机展示的内容"
            : "随机内容加载失败，请稍后重试。",
      });
    } finally {
      setIsRandomLoading(false);
    }
  }

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 top-4 z-40 flex justify-center px-4 md:top-auto md:bottom-6">
        <TransitionPresence
          show={!isCheckingAdmin}
          className="pointer-events-auto"
        >
          <nav aria-label="主要操作" className="flex items-center gap-3">
            <ButtonGroup
              aria-label="Moments 工具"
              className="[--radius:9999rem] rounded-full border bg-background p-1 shadow-sm"
            >
              <ToolbarButton label="首页" icon={HouseIcon} onClick={openHome} />
              <ToolbarButton
                label="统计信息"
                icon={CalendarDaysIcon}
                onClick={openStatistics}
              />
              <ToolbarButton
                label={isRandomLoading ? "正在获取随机内容" : "随机"}
                icon={DicesIcon}
                disabled={isRandomLoading}
                onClick={() => void loadRandom(true)}
              />
              <div
                aria-hidden={!isAdmin}
                inert={!isAdmin ? true : undefined}
                className={`flex origin-left overflow-hidden transition-[width,opacity,transform] duration-200 ease-out motion-reduce:transition-none ${
                  isAdmin
                    ? "w-18 scale-100 opacity-100"
                    : "pointer-events-none w-0 scale-95 opacity-0"
                }`}
              >
                <ToolbarButton
                  label="回收站"
                  icon={Trash2Icon}
                  onClick={openTrash}
                />
                <ToolbarButton label="设置" icon={SettingsIcon} reserved />
              </div>
            </ButtonGroup>

            <div className="flex size-11 items-center justify-center overflow-hidden rounded-full border bg-background shadow-sm">
              <AuthControls compact />
            </div>
          </nav>
        </TransitionPresence>
      </div>
      {randomDetail ? (
        <RandomMomentDialog
          detail={randomDetail}
          isRefreshing={isRandomLoading}
          open={randomOpen}
          onOpenChange={setRandomOpen}
          onRequestAnother={() => void loadRandom(false)}
        />
      ) : null}
    </>
  );
}
