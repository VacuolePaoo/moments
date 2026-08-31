"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { CheckIcon, PauseIcon, PlayIcon, XIcon } from "lucide-react";
import { useReactMediaRecorder } from "react-media-recorder";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { VoicePlayer } from "./voice-player";

const MAX_RECORDING_DURATION_MS = 30 * 60 * 1000;

export interface VoiceRecordingDraft {
  blob: Blob;
  durationMs: number;
  mimeType: string;
}

function preferredMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((type) =>
    MediaRecorder.isTypeSupported(type),
  );
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, "0")}`;
}

function cssColor(name: string, fallback: string): string {
  return (
    window.getComputedStyle(document.documentElement).getPropertyValue(name).trim() ||
    fallback
  );
}

function RecordingWaveform({
  track,
  sampling,
  session,
}: {
  track: MediaStreamTrack | null;
  sampling: boolean;
  session: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const samplingRef = useRef(sampling);

  useEffect(() => {
    samplingRef.current = sampling;
  }, [sampling]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    const foreground = cssColor("--foreground", "#171717");
    const muted = cssColor("--muted-foreground", "#737373");
    const marker = cssColor("--destructive", "#dc2626");

    const samples: number[] = [];
    let animationFrame = 0;
    let lastSampleAt = 0;
    let audioContext: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let analyser: AnalyserNode | null = null;
    let frequencyData: Uint8Array<ArrayBuffer> | null = null;

    if (track) {
      audioContext = new AudioContext();
      source = audioContext.createMediaStreamSource(new MediaStream([track]));
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.72;
      frequencyData = new Uint8Array(analyser.frequencyBinCount);
      source.connect(analyser);
      void audioContext.resume();
    }

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(bounds.width * ratio));
      canvas.height = Math.max(1, Math.round(bounds.height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const draw = (timestamp: number) => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const centerX = Math.round(width / 2);
      const barWidth = 2;
      const step = 5;

      if (
        analyser &&
        frequencyData &&
        samplingRef.current &&
        timestamp - lastSampleAt >= 64
      ) {
        analyser.getByteFrequencyData(frequencyData);
        let total = 0;
        const usefulBins = Math.min(48, frequencyData.length);
        for (let index = 2; index < usefulBins; index += 1) {
          total += frequencyData[index] ?? 0;
        }
        const level = total / Math.max(1, usefulBins - 2) / 128;
        samples.push(Math.max(0.08, Math.min(1, level)));
        lastSampleAt = timestamp;
      }

      // 历史条从指针向左铺满；多保留一条让它被左缘裁切，避免左端留白。
      const visibleBars = Math.max(
        1,
        Math.floor((centerX + step - barWidth) / step),
      );
      if (samples.length > visibleBars + 1) {
        samples.splice(0, samples.length - visibleBars - 1);
      }

      context.clearRect(0, 0, width, height);
      context.fillStyle = muted;
      context.globalAlpha = 0.75;
      samples.forEach((sample, index) => {
        const barHeight = Math.max(3, sample * (height - 22));
        const x = centerX - barWidth - (samples.length - 1 - index) * step;
        context.fillRect(x, (height - barHeight) / 2, barWidth, barHeight);
      });

      // 右侧占位条紧贴指针并按实际宽度均分，最后一条恰好抵达右缘。
      const regionStart = centerX + barWidth;
      const regionWidth = width - regionStart;
      if (regionWidth >= barWidth) {
        const count = Math.max(
          1,
          Math.round((regionWidth - barWidth) / step) + 1,
        );
        const spacing = (regionWidth - barWidth) / Math.max(1, count - 1);
        context.globalAlpha = 0.18;
        for (let index = 0; index < count; index += 1) {
          const barHeight = 2;
          const x = regionStart + Math.round(index * spacing);
          context.fillRect(x, (height - barHeight) / 2, barWidth, barHeight);
        }
      }

      context.globalAlpha = 0.4;
      context.fillStyle = samplingRef.current ? marker : foreground;
      context.fillRect(centerX, 0, 1.5, height);
      context.globalAlpha = 1;
      animationFrame = window.requestAnimationFrame(draw);
    };
    animationFrame = window.requestAnimationFrame(draw);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      observer.disconnect();
      source?.disconnect();
      analyser?.disconnect();
      if (audioContext) void audioContext.close();
    };
  }, [session, track]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 size-full"
      aria-hidden="true"
    />
  );
}

function VoiceAction({
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

export function VoiceComposer({
  disabled = false,
  onDraftChange,
  onBusyChange,
}: {
  disabled?: boolean;
  onDraftChange: (draft: VoiceRecordingDraft | null) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [recording, setRecording] = useState<Blob | null>(null);
  const [durationMs, setDurationMs] = useState(0);
  const [session, setSession] = useState(0);
  const segmentStartedAtRef = useRef(0);
  const accumulatedMsRef = useRef(0);
  const durationMsRef = useRef(0);
  const discardOnStopRef = useRef(false);
  const [mimeType] = useState(preferredMimeType);
  const {
    status,
    error,
    mediaBlobUrl,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    clearBlobUrl,
    previewAudioStream,
  } = useReactMediaRecorder({
    audio: true,
    stopStreamsOnStop: true,
    mediaRecorderOptions: mimeType ? { mimeType } : undefined,
    blobPropertyBag: mimeType ? { type: mimeType } : undefined,
    onStart: () => {
      segmentStartedAtRef.current = Date.now();
      accumulatedMsRef.current = 0;
      durationMsRef.current = 0;
      setDurationMs(0);
      setRecording(null);
      onDraftChange(null);
    },
    onStop: (url, blob) => {
      if (discardOnStopRef.current) {
        discardOnStopRef.current = false;
        URL.revokeObjectURL(url);
        setRecording(null);
        return;
      }
      const finalDuration = Math.max(1, durationMsRef.current);
      setDurationMs(finalDuration);
      setRecording(blob);
      onDraftChange({
        blob,
        durationMs: finalDuration,
        mimeType: blob.type || mimeType || "audio/webm",
      });
    },
  });

  useEffect(() => {
    if (status !== "recording") return;
    const timer = window.setInterval(() => {
      const elapsed = Math.min(
        MAX_RECORDING_DURATION_MS,
        accumulatedMsRef.current + Date.now() - segmentStartedAtRef.current,
      );
      durationMsRef.current = elapsed;
      setDurationMs(elapsed);
      if (elapsed >= MAX_RECORDING_DURATION_MS) stopRecording();
    }, 125);
    return () => window.clearInterval(timer);
  }, [status, stopRecording]);

  const recordingInProgress =
    status === "recording" || status === "paused" || status === "stopping";
  const busy = recordingInProgress || status === "acquiring_media";

  useEffect(() => {
    onBusyChange(busy);
  }, [busy, onBusyChange]);

  useEffect(
    () => () => {
      onBusyChange(false);
      onDraftChange(null);
    },
    [onBusyChange, onDraftChange],
  );

  useEffect(() => {
    const description =
      error === "permission_denied"
        ? "没有麦克风权限，请在浏览器设置中允许后重试。"
        : error
          ? "录音设备暂时不可用。"
          : null;
    if (description) toast.add({ type: "error", description });
  }, [error]);

  function updateRunningDuration() {
    const elapsed = Math.min(
      MAX_RECORDING_DURATION_MS,
      accumulatedMsRef.current + Date.now() - segmentStartedAtRef.current,
    );
    accumulatedMsRef.current = elapsed;
    durationMsRef.current = elapsed;
    setDurationMs(elapsed);
  }

  function begin() {
    discardOnStopRef.current = false;
    setSession((current) => current + 1);
    startRecording();
  }

  function pause() {
    updateRunningDuration();
    pauseRecording();
  }

  function resume() {
    segmentStartedAtRef.current = Date.now();
    resumeRecording();
  }

  function finish() {
    if (status === "recording") updateRunningDuration();
    stopRecording();
  }

  function reset() {
    onDraftChange(null);
    setRecording(null);
    setDurationMs(0);
    accumulatedMsRef.current = 0;
    durationMsRef.current = 0;
    if (status === "recording" || status === "paused") {
      discardOnStopRef.current = true;
      stopRecording();
      return;
    }
    clearBlobUrl();
  }

  const audioTrack = previewAudioStream?.getAudioTracks()[0] ?? null;
  const isRecording = status === "recording" || status === "stopping";

  return (
    <section aria-label="声音录制" className="w-full">
      {recording && mediaBlobUrl ? (
        <VoicePlayer
          audio={{
            url: mediaBlobUrl,
            durationMs: Math.max(1, durationMs),
            mimeType: recording.type || "audio/webm",
            sizeBytes: recording.size,
          }}
          disabled={disabled}
          onDelete={reset}
        />
      ) : (
        <Card className="h-32 min-h-32 gap-0 overflow-hidden py-0">
          <CardContent className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_7rem] grid-rows-[minmax(0,1fr)] p-0 sm:grid-cols-[minmax(0,1fr)_8rem]">
            <div className="relative min-h-0 min-w-0 overflow-hidden border-r">
              <RecordingWaveform
                track={audioTrack}
                sampling={status === "recording"}
                session={session}
              />
            </div>
            <div className="flex min-h-0 min-w-0 flex-col overflow-hidden p-2">
              <div
                className={cn(
                  "flex flex-1 items-center justify-center font-mono text-sm tabular-nums",
                  isRecording && "text-destructive",
                )}
                aria-live="polite"
              >
                {formatDuration(durationMs)}
              </div>
              <div className="flex min-h-8 items-center justify-center gap-1">
                {recordingInProgress ? (
                  <>
                    <VoiceAction
                      label="清除录音"
                      disabled={disabled || status === "stopping"}
                      onClick={reset}
                    >
                      <XIcon />
                    </VoiceAction>
                    {status === "paused" ? (
                      <VoiceAction label="继续录音" disabled={disabled} onClick={resume}>
                        <PlayIcon />
                      </VoiceAction>
                    ) : (
                      <VoiceAction
                        label="暂停录音"
                        disabled={disabled || status === "stopping"}
                        onClick={pause}
                      >
                        <PauseIcon />
                      </VoiceAction>
                    )}
                    <VoiceAction
                      label="结束录音"
                      disabled={disabled || status === "stopping"}
                      onClick={finish}
                    >
                      <CheckIcon />
                    </VoiceAction>
                  </>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    className="w-full"
                    disabled={disabled || status === "acquiring_media"}
                    onClick={begin}
                  >
                    {status === "acquiring_media" ? (
                      <Spinner data-icon="inline-start" />
                    ) : (
                      <span
                        data-icon="inline-start"
                        className="size-2.5 rounded-full bg-current"
                        aria-hidden="true"
                      />
                    )}
                    {status === "acquiring_media" ? "准备中" : "开始录音"}
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      {error ? <span className="sr-only" role="alert">录音设备不可用</span> : null}
    </section>
  );
}
