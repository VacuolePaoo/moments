"use client";

import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { CornerDownLeftIcon, ImagePlusIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { createPost, type MomentPost } from "./api";
import { publishDraftKey, readDraft, removeDraft, writeDraft } from "./drafts";
import {
  EditableImageAttachments,
  editableImagesFromFiles,
  releaseEditableImage,
  uploadEditableImages,
  type EditableImage,
} from "./image-attachments";

interface ComposerProps {
  getToken: () => Promise<string | null>;
  onCreated: (post: MomentPost) => void;
}

export const Composer = forwardRef<HTMLTextAreaElement, ComposerProps>(
  function Composer({ getToken, onCreated }, ref) {
    const [content, setContent] = useState("");
    const [images, setImages] = useState<EditableImage[]>([]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [draftSaved, setDraftSaved] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const imagesRef = useRef(images);
    const draftKey = publishDraftKey();

    useEffect(() => {
      imagesRef.current = images;
    }, [images]);

    useEffect(() => {
      const draft = readDraft(draftKey);
      if (draft?.content) setContent(draft.content);
    }, [draftKey]);

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

    function addImages(event: ChangeEvent<HTMLInputElement>) {
      const selected = Array.from(event.target.files ?? []).filter((file) =>
        file.type.startsWith("image/"),
      );
      if (selected.length > 0) {
        setImages((current) => [
          ...current,
          ...editableImagesFromFiles(selected),
        ]);
      }
      event.target.value = "";
    }

    function removeImage(image: EditableImage) {
      releaseEditableImage(image);
      setImages((current) => current.filter((item) => item.id !== image.id));
    }

    async function publish() {
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
        images.forEach(releaseEditableImage);
        setImages([]);
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

    const canPublish = content.trim().length > 0 || images.length > 0;

    return (
      <form
        className="flex w-full flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void publish();
        }}
      >
        <EditableImageAttachments
          images={images}
          disabled={isSubmitting}
          onRemove={removeImage}
        />
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
              void publish();
            }
          }}
          className="min-h-32 resize-none text-base leading-6 md:text-base"
          disabled={isSubmitting}
        />

        <div className="flex items-center justify-between gap-4">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            tabIndex={-1}
            onChange={addImages}
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

          <div className="flex items-center gap-3">
            {draftSaved ? (
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
