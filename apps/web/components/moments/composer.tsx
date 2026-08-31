"use client";

import dynamic from "next/dynamic";
import { CornerDownLeftIcon, ImagePlusIcon, MicIcon } from "lucide-react";
import { forwardRef, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import {
  createAudioPost,
  createPost,
  uploadRecording,
  type MomentPost,
} from "./api";
import { publishDraftKey, readDraft, removeDraft, writeDraft } from "./drafts";
import {
  EditableImageAttachments,
  EditableImageInput,
  releaseEditableImage,
  uploadEditableImages,
  type EditableImage,
} from "./image-attachments";
import { useSiteSettings } from "./site-settings";
import type { VoiceRecordingDraft } from "./voice-composer";

interface ComposerProps {
  getToken: () => Promise<string | null>;
  onCreated: (post: MomentPost) => void;
  initialContent?: string;
}

const VoiceComposer = dynamic(
  () => import("./voice-composer").then((module) => module.VoiceComposer),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-32 min-h-32 items-center justify-center rounded-xl border">
        <Spinner />
      </div>
    ),
  },
);

function extensionForMimeType(mimeType: string): string {
  return mimeType.includes("mp4") ? "m4a" : "webm";
}

export const Composer = forwardRef<HTMLTextAreaElement, ComposerProps>(
  function Composer({ getToken, onCreated, initialContent }, ref) {
    const { fileUploadConfigured } = useSiteSettings();
    const [content, setContent] = useState("");
    const [images, setImages] = useState<EditableImage[]>([]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [draftSaved, setDraftSaved] = useState(false);
    const [mode, setMode] = useState<"article" | "audio">("article");
    const [voiceBusy, setVoiceBusy] = useState(false);
    const [voiceDraft, setVoiceDraft] = useState<VoiceRecordingDraft | null>(
      null,
    );
    const [voiceComposerKey, setVoiceComposerKey] = useState(0);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const imagesRef = useRef(images);
    const draftKey = publishDraftKey();

    useEffect(() => {
      imagesRef.current = images;
    }, [images]);

    useEffect(() => {
      if (initialContent) {
        setContent(initialContent);
        return;
      }
      const draft = readDraft(draftKey);
      if (draft?.content) setContent(draft.content);
    }, [draftKey, initialContent]);

    useEffect(() => {
      if (!content) return;
      const timer = window.setTimeout(() => {
        const saved = writeDraft(draftKey, content);
        setDraftSaved(saved);
        if (!saved) toast.add({ type: "error", description: "草稿保存失败。" });
      }, 5000);
      return () => window.clearTimeout(timer);
    }, [content, draftKey]);

    useEffect(
      () => () => {
        imagesRef.current.forEach(releaseEditableImage);
      },
      [],
    );

    function updateImage(id: string, values: Partial<EditableImage>) {
      setImages((current) =>
        current.map((image) =>
          image.id === id ? { ...image, ...values } : image,
        ),
      );
    }

    function handleContentChange(value: string) {
      setContent(value);
      setDraftSaved(false);
      if (!value) removeDraft(draftKey);
    }

    function removeImage(image: EditableImage) {
      releaseEditableImage(image);
      setImages((current) => current.filter((item) => item.id !== image.id));
    }

    function clearPublishedImages() {
      images.forEach(releaseEditableImage);
      setImages([]);
    }

    async function publishArticle() {
      if ((!content.trim() && images.length === 0) || isSubmitting) return;
      setIsSubmitting(true);
      try {
        const token = await getToken();
        if (!token) throw new Error("登录状态已失效。");
        const imageUrls = await uploadEditableImages(
          images,
          token,
          updateImage,
        );
        const post = await createPost(content, imageUrls, token);
        onCreated(post);
        clearPublishedImages();
        setContent("");
        removeDraft(draftKey);
        setDraftSaved(false);
      } catch (error) {
        toast.add({
          type: "error",
          description:
            error instanceof Error ? error.message : "发布失败，请稍后重试。",
        });
      } finally {
        setIsSubmitting(false);
      }
    }

    async function publishAudio() {
      if (!voiceDraft || isSubmitting) return;
      setIsSubmitting(true);
      try {
        const token = await getToken();
        if (!token) throw new Error("登录状态已失效。");
        const imageUrls = await uploadEditableImages(
          images,
          token,
          updateImage,
        );
        const file = new File(
          [voiceDraft.blob],
          `recording-${new Date().toISOString().replaceAll(":", "-")}.${extensionForMimeType(voiceDraft.mimeType)}`,
          { type: voiceDraft.mimeType },
        );
        const hosted = await uploadRecording(file, token);
        const post = await createAudioPost(
          { ...hosted, durationMs: voiceDraft.durationMs },
          imageUrls,
          token,
        );
        onCreated(post);
        clearPublishedImages();
        setVoiceDraft(null);
        setVoiceComposerKey((current) => current + 1);
      } catch (error) {
        toast.add({
          type: "error",
          description:
            error instanceof Error
              ? error.message
              : "声音发布失败，请稍后重试。",
        });
      } finally {
        setIsSubmitting(false);
      }
    }

    const canPublish =
      mode === "audio"
        ? voiceDraft !== null
        : content.trim().length > 0 || images.length > 0;

    return (
      <form
        className="flex w-full min-w-0 flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (mode === "audio") {
            void publishAudio();
          } else {
            void publishArticle();
          }
        }}
      >
        <EditableImageAttachments
          images={images}
          disabled={isSubmitting}
          onRemove={removeImage}
        />

        {mode === "audio" ? (
          <VoiceComposer
            key={voiceComposerKey}
            disabled={isSubmitting}
            onDraftChange={setVoiceDraft}
            onBusyChange={setVoiceBusy}
          />
        ) : (
          <>
            <Label htmlFor="moment-composer" className="sr-only">
              发布说说
            </Label>
            <Textarea
              ref={ref}
              id="moment-composer"
              value={content}
              onChange={(event) => handleContentChange(event.target.value)}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                  event.preventDefault();
                  void publishArticle();
                }
              }}
              className="h-32 min-h-32 resize-none text-base leading-6 md:text-base"
              disabled={isSubmitting}
            />
          </>
        )}

        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center">
            {fileUploadConfigured ? (
              <>
                <EditableImageInput
                  inputRef={fileInputRef}
                  currentCount={images.length}
                  onAccepted={(accepted) =>
                    setImages((current) => [...current, ...accepted])
                  }
                />
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="添加图片"
                        disabled={isSubmitting}
                        onClick={() => fileInputRef.current?.click()}
                      />
                    }
                  >
                    <ImagePlusIcon />
                  </TooltipTrigger>
                  <TooltipContent>添加图片</TooltipContent>
                </Tooltip>
              </>
            ) : null}

            <div className="ml-5 flex items-center gap-2">
              <MicIcon className="size-4 text-muted-foreground" aria-hidden="true" />
              <Switch
                size="sm"
                aria-label="切换语音发布"
                checked={mode === "audio"}
                disabled={
                  !fileUploadConfigured ||
                  isSubmitting ||
                  voiceBusy ||
                  // 已录制的音频只存在于内存中，切回文字模式会丢失，需先清除。
                  (mode === "audio" && voiceDraft !== null)
                }
                onCheckedChange={(checked) => {
                  setMode(checked ? "audio" : "article");
                  if (!checked) {
                    setVoiceDraft(null);
                    setVoiceComposerKey((current) => current + 1);
                  }
                }}
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            {mode === "article" && draftSaved ? (
              <span className="text-sm text-muted-foreground opacity-70">
                已自动保存
              </span>
            ) : null}
            <Button type="submit" disabled={!canPublish || isSubmitting}>
              {isSubmitting ? <Spinner data-icon="inline-start" /> : null}
              {isSubmitting ? "发布中" : "发布"}
              {!isSubmitting ? (
                <CornerDownLeftIcon data-icon="inline-end" />
              ) : null}
            </Button>
          </div>
        </div>
      </form>
    );
  },
);
