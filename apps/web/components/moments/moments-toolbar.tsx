"use client";

import { useRouter } from "next/navigation";
import type { ComponentType, SVGProps } from "react";
import {
  CalendarDaysIcon,
  DicesIcon,
  PlusIcon,
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

export function MomentsToolbar({
  isAdmin,
  onPublish,
}: {
  isAdmin: boolean;
  onPublish?: () => void;
}) {
  const router = useRouter();
  const publish = isAdmin ? (onPublish ?? (() => router.push("/"))) : undefined;
  const openTrash = isAdmin ? () => router.push("/trash") : undefined;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-40 flex justify-center px-4 md:top-auto md:bottom-6">
      <nav
        aria-label="主要操作"
        className="pointer-events-auto flex items-center gap-3"
      >
        <ButtonGroup
          aria-label="Moments 工具"
          className="[--radius:9999rem] rounded-full border bg-background p-1 shadow-sm"
        >
          <ToolbarButton label="发布" icon={PlusIcon} onClick={publish} />
          <ToolbarButton label="日历" icon={CalendarDaysIcon} reserved />
          <ToolbarButton label="随机" icon={DicesIcon} reserved />
          <ToolbarButton label="回收站" icon={Trash2Icon} onClick={openTrash} />
          <ToolbarButton label="设置" icon={SettingsIcon} reserved />
        </ButtonGroup>

        <div className="flex size-11 items-center justify-center overflow-hidden rounded-full border bg-background shadow-sm">
          <AuthControls compact />
        </div>
      </nav>
    </div>
  );
}
