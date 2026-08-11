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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { AuthControls } from "./auth-controls";
import { RandomMomentDialog } from "./random-moment-dialog";

type ToolbarIcon = ComponentType<SVGProps<SVGSVGElement>>;

function ToolbarButton({
  label,
  icon: Icon,
  onClick,
  reserved = false,
}: {
  label: string;
  icon: ToolbarIcon;
  onClick?: () => void;
  reserved?: boolean;
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

export function MomentsToolbar({ isAdmin }: { isAdmin: boolean }) {
  const router = useRouter();
  const [randomOpen, setRandomOpen] = useState(false);
  const openHome = () => router.push("/");
  const openStatistics = () => router.push("/statistics");
  const openTrash = () => router.push("/trash");

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 top-4 z-40 flex justify-center px-4 md:top-auto md:bottom-6">
        <nav
          aria-label="主要操作"
          className="pointer-events-auto flex items-center gap-3"
        >
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
              label="随机"
              icon={DicesIcon}
              onClick={() => setRandomOpen(true)}
            />
            {isAdmin ? (
              <>
                <ToolbarButton
                  label="回收站"
                  icon={Trash2Icon}
                  onClick={openTrash}
                />
                <ToolbarButton label="设置" icon={SettingsIcon} reserved />
              </>
            ) : null}
          </ButtonGroup>

          <div className="flex size-11 items-center justify-center overflow-hidden rounded-full border bg-background shadow-sm">
            <AuthControls compact />
          </div>
        </nav>
      </div>
      <RandomMomentDialog open={randomOpen} onOpenChange={setRandomOpen} />
    </>
  );
}
