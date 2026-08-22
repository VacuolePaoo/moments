"use client";

import Image from "next/image";
import { XIcon } from "lucide-react";
import type { ChangeEvent, RefObject } from "react";

import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment";
import { ImageZoom } from "@/components/kibo-ui/image-zoom";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

import { MAX_IMAGES_PER_POST, uploadImage } from "./api";

type ImageUploadState = "idle" | "uploading" | "error" | "done";

export interface EditableImage {
  id: string;
  name: string;
  previewUrl: string;
  state: ImageUploadState;
  file?: File;
  url?: string;
}

function passthroughLoader({ src }: { src: string }) {
  return src;
}

function fileNameFromUrl(value: string, index: number): string {
  try {
    const name = new URL(value).pathname.split("/").filter(Boolean).at(-1);
    return name ? decodeURIComponent(name) : `图片 ${index + 1}`;
  } catch {
    return `图片 ${index + 1}`;
  }
}

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function editableImagesFromFiles(files: File[]): EditableImage[] {
  return files.map((file) => ({
    id: crypto.randomUUID(),
    name: file.name,
    previewUrl: URL.createObjectURL(file),
    state: "idle",
    file,
  }));
}

function selectEditableImages(
  files: Iterable<File>,
  currentCount: number,
): { accepted: EditableImage[]; truncated: boolean } {
  const selected = Array.from(files).filter((file) =>
    file.type.startsWith("image/"),
  );
  const remaining = Math.max(0, MAX_IMAGES_PER_POST - currentCount);
  const accepted = selected.slice(0, remaining);
  return {
    accepted: editableImagesFromFiles(accepted),
    truncated: accepted.length < selected.length,
  };
}

function handleEditableImageSelection(
  event: ChangeEvent<HTMLInputElement>,
  currentCount: number,
  onAccepted: (images: EditableImage[]) => void,
): void {
  const { accepted, truncated } = selectEditableImages(
    event.target.files ?? [],
    currentCount,
  );
  if (truncated) {
    toast.add({
      type: "warning",
      description: `每条说说最多添加 ${MAX_IMAGES_PER_POST} 张图片。`,
    });
  }
  if (accepted.length > 0) onAccepted(accepted);
  event.target.value = "";
}

export function EditableImageInput({
  inputRef,
  currentCount,
  onAccepted,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  currentCount: number;
  onAccepted: (images: EditableImage[]) => void;
}) {
  return (
    <input
      ref={inputRef}
      type="file"
      accept="image/*"
      multiple
      className="sr-only"
      tabIndex={-1}
      onChange={(event) =>
        handleEditableImageSelection(event, currentCount, onAccepted)
      }
    />
  );
}

export function editableImagesFromUrls(urls: string[]): EditableImage[] {
  return urls.map((url, index) => ({
    id: `remote-${index}-${url}`,
    name: fileNameFromUrl(url, index),
    previewUrl: url,
    state: "done",
    url,
  }));
}

export function releaseEditableImage(image: EditableImage) {
  if (image.file) URL.revokeObjectURL(image.previewUrl);
}

export async function uploadEditableImages(
  images: EditableImage[],
  token: string,
  update: (id: string, values: Partial<EditableImage>) => void,
): Promise<string[]> {
  const urls = new Array<string>(images.length);
  let nextIndex = 0;
  let firstError: unknown;
  const concurrency = Math.min(3, images.length);

  async function worker() {
    while (firstError === undefined) {
      const index = nextIndex;
      nextIndex += 1;
      const image = images[index];
      if (!image) return;

      if (image.url) {
        urls[index] = image.url;
        continue;
      }
      if (!image.file) {
        firstError = new Error("图片文件已失效，请重新选择。");
        return;
      }

      update(image.id, { state: "uploading" });
      try {
        const url = await uploadImage(image.file, token);
        urls[index] = url;
        update(image.id, { state: "done", url });
      } catch (error) {
        update(image.id, { state: "error" });
        firstError = error;
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  if (firstError !== undefined) throw firstError;
  return urls;
}

export function EditableImageAttachments({
  images,
  disabled = false,
  onRemove,
}: {
  images: EditableImage[];
  disabled?: boolean;
  onRemove: (image: EditableImage) => void;
}) {
  if (images.length === 0) return null;

  return (
    <AttachmentGroup role="group" aria-label="待发布图片" tabIndex={0}>
      {images.map((image) => (
        <Attachment
          key={image.id}
          state={image.state}
          orientation="vertical"
          size="sm"
          className="w-32 sm:w-36"
        >
          <AttachmentMedia variant="image" className="w-full!">
            <Image
              loader={passthroughLoader}
              unoptimized
              fill
              sizes="144px"
              src={image.previewUrl}
              alt={image.name}
            />
          </AttachmentMedia>
          <AttachmentContent>
            <AttachmentTitle>{image.name}</AttachmentTitle>
            <AttachmentDescription>
              {image.state === "uploading"
                ? "正在上传"
                : image.state === "error"
                  ? "上传失败"
                  : image.file
                    ? formatFileSize(image.file.size)
                    : "已上传"}
            </AttachmentDescription>
          </AttachmentContent>
          <AttachmentActions>
            <AttachmentAction
              type="button"
              aria-label={`移除 ${image.name}`}
              disabled={disabled}
              onClick={() => onRemove(image)}
            >
              <XIcon />
            </AttachmentAction>
          </AttachmentActions>
        </Attachment>
      ))}
    </AttachmentGroup>
  );
}

export function MomentImages({
  images,
  eager = false,
}: {
  images: string[];
  eager?: boolean;
}) {
  if (images.length === 0) return null;

  if (images.length === 1) {
    const url = images[0];
    return url ? (
      <ZoomableMomentImage url={url} index={0} eager={eager} single />
    ) : null;
  }

  return (
    <ScrollArea
      className="w-full min-w-0 max-w-full overflow-hidden whitespace-nowrap"
      aria-label="说说图片"
    >
      <div className="flex w-max gap-3 pb-3">
        {images.map((url, index) => (
          <ZoomableMomentImage
            key={`${index}-${url}`}
            url={url}
            index={index}
            eager={eager && index === 0}
          />
        ))}
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
}

function ZoomableMomentImage({
  url,
  index,
  eager,
  single = false,
}: {
  url: string;
  index: number;
  eager: boolean;
  single?: boolean;
}) {
  return (
    <ImageZoom
      className={cn("shrink-0", single ? "max-w-full" : undefined)}
      a11yNameButtonZoom={`放大说说图片 ${index + 1}`}
      a11yNameButtonUnzoom="关闭图片灯箱"
    >
      <div
        className={cn(
          "relative aspect-4/3 overflow-hidden rounded-lg",
          single ? "w-64 max-w-full sm:w-80" : "w-36 sm:w-44",
        )}
      >
        <Image
          loader={passthroughLoader}
          unoptimized
          fill
          sizes={single ? "320px" : "176px"}
          src={url}
          alt={`说说图片 ${index + 1}`}
          className="object-cover"
          loading={eager ? "eager" : "lazy"}
        />
      </div>
    </ImageZoom>
  );
}
