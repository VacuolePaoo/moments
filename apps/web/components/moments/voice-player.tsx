"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { PauseIcon, PlayIcon, XIcon } from "lucide-react";
import { useWavesurfer } from "@wavesurfer/react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import type { AudioMetadata } from "./api";

function formatDuration(seconds: number): string {
  const rounded = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(rounded / 60);
  return `${String(minutes)}:${String(rounded % 60).padStart(2, "0")}`;
}

function semanticColor(name: string, fallback: string): string {
  const value = window
    .getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

function IconButtonWithTooltip({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function VoicePlayer({
  audio,
  disabled = false,
  variant = "card",
  onDelete,
  time,
  trailing,
}: {
  audio: AudioMetadata;
  disabled?: boolean;
  /** card: 发布器里录制完成的卡片;inline: 已发布 moment 中直接铺在页面上的形态。 */
  variant?: "card" | "inline";
  onDelete?: () => void;
  time?: ReactNode;
  trailing?: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const hoverProgressRef = useRef<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [colors] = useState(() => ({
    progress: semanticColor("--foreground", "oklch(0.145 0 0)"),
    wave: semanticColor("--muted-foreground", "oklch(0.556 0 0)"),
  }));
  const { wavesurfer, isReady, isPlaying, currentTime } = useWavesurfer({
    container: containerRef,
    url: audio.url,
    height: variant === "inline" ? 40 : 64,
    waveColor: colors.wave,
    progressColor: colors.progress,
    cursorColor: colors.progress,
    cursorWidth: 1,
    barWidth: 2,
    barGap: 2,
    barRadius: 2,
    normalize: true,
  });

  useEffect(() => {
    if (!wavesurfer) return;
    const unsubscribe = wavesurfer.on("error", () => setFailed(true));
    return unsubscribe;
  }, [wavesurfer]);

  // 悬停预览：指针与已播放/未播放配色跟随鼠标，移开后回到真实播放位置。
  useEffect(() => {
    const container = containerRef.current;
    if (!wavesurfer || !container || !isReady) return;

    const renderer = wavesurfer.getRenderer();

    const restore = () => {
      const duration = wavesurfer.getDuration();
      renderer.renderProgress(
        duration > 0 ? wavesurfer.getCurrentTime() / duration : 0,
        wavesurfer.isPlaying(),
      );
    };

    const preview = (event: PointerEvent) => {
      const bounds = container.getBoundingClientRect();
      if (bounds.width === 0) return;
      const progress = Math.min(
        1,
        Math.max(0, (event.clientX - bounds.left) / bounds.width),
      );
      hoverProgressRef.current = progress;
      renderer.renderProgress(progress);
    };

    const leave = () => {
      hoverProgressRef.current = null;
      restore();
    };

    // 播放时 wavesurfer 每帧重绘进度，需要在其之后重新套用悬停位置。
    const unsubscribe = wavesurfer.on("timeupdate", () => {
      const hovered = hoverProgressRef.current;
      if (hovered !== null) renderer.renderProgress(hovered);
    });

    container.addEventListener("pointermove", preview);
    container.addEventListener("pointerleave", leave);
    return () => {
      container.removeEventListener("pointermove", preview);
      container.removeEventListener("pointerleave", leave);
      unsubscribe();
      hoverProgressRef.current = null;
    };
  }, [isReady, wavesurfer]);

  const totalTime = wavesurfer?.getDuration() || audio.durationMs / 1000;
  const playLabel = isPlaying ? "暂停录音" : "播放录音";

  const playButton = (
    <IconButtonWithTooltip
      label={playLabel}
      disabled={disabled || !isReady || failed}
      onClick={() => void wavesurfer?.playPause()}
    >
      {isPlaying ? <PauseIcon /> : <PlayIcon />}
    </IconButtonWithTooltip>
  );

  if (variant === "inline") {
    return (
      <div className="flex min-w-0 max-w-full flex-col gap-2">
        {failed ? (
          <audio className="w-full" controls preload="metadata" src={audio.url}>
            当前浏览器无法播放此录音。
          </audio>
        ) : (
          <div className="grid h-14 w-full min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center overflow-hidden rounded-xl border">
            <div className="flex h-full shrink-0 items-center gap-1.5 border-r pr-3 pl-2">
              {playButton}
              <span
                className="font-mono text-xs tabular-nums text-muted-foreground"
                aria-live="polite"
              >
                {formatDuration(currentTime)} / {formatDuration(totalTime)}
              </span>
            </div>
            <div className="min-w-0 px-3">
              <div className="cursor-pointer" ref={containerRef} />
            </div>
          </div>
        )}
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-base leading-[1.6] text-muted-foreground">
            语音
          </span>
          {time}
          {trailing ? (
            <div className="ml-auto flex items-center">{trailing}</div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <Card className="h-32 min-h-32 gap-0 overflow-hidden py-0">
      <CardContent className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_7rem] grid-rows-[minmax(0,1fr)] p-0 sm:grid-cols-[minmax(0,1fr)_8rem]">
        <div className="flex min-h-0 min-w-0 items-center overflow-hidden border-r px-3 py-2">
          {failed ? (
            <audio className="w-full" controls preload="metadata" src={audio.url}>
              当前浏览器无法播放此录音。
            </audio>
          ) : (
            <div className="min-w-0 flex-1 cursor-pointer" ref={containerRef} />
          )}
        </div>
        <div className="flex min-h-0 min-w-0 flex-col overflow-hidden p-2">
          <div
            className="flex flex-1 items-center justify-center font-mono text-xs tabular-nums"
            aria-live="polite"
          >
            {formatDuration(currentTime)} / {formatDuration(totalTime)}
          </div>
          <div className="flex min-h-8 items-center justify-center gap-1">
            {onDelete ? (
              <>
                <IconButtonWithTooltip
                  label="删除录音"
                  disabled={disabled}
                  onClick={onDelete}
                >
                  <XIcon />
                </IconButtonWithTooltip>
                <span className="size-7 shrink-0" aria-hidden="true" />
              </>
            ) : null}
            {playButton}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
