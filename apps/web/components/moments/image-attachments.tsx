"use client";

import Image from "next/image";
import { XIcon } from "lucide-react";

import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "@/components/ui/attachment";
import { cn } from "@/lib/utils";

import { uploadImage } from "./api";

export type ImageUploadState = "idle" | "uploading" | "error" | "done";

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

export function editableImagesFromFiles(files: File[]): EditableImage[] {
  return files.map((file) => ({
    id: crypto.randomUUID(),
    name: file.name,
    previewUrl: URL.createObjectURL(file),
    state: "idle",
    file,
  }));
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
  const urls: string[] = [];
  for (const image of images) {
    if (image.url) {
      urls.push(image.url);
      continue;
    }
    if (!image.file) throw new Error("图片文件已失效，请重新选择。");

    update(image.id, { state: "uploading" });
    try {
      const url = await uploadImage(image.file, token);
      update(image.id, { state: "done", url });
      urls.push(url);
    } catch (error) {
      update(image.id, { state: "error" });
      throw error;
    }
  }
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

  return (
    <AttachmentGroup role="group" aria-label="说说图片" tabIndex={0}>
      {images.map((url, index) => {
        const name = fileNameFromUrl(url, index);
        return (
          <Attachment
            key={`${index}-${url}`}
            orientation="vertical"
            size="sm"
            className={cn(
              images.length === 1 ? "w-64 sm:w-80" : "w-36 sm:w-44",
            )}
          >
            <AttachmentMedia variant="image" className="w-full!">
              <Image
                loader={passthroughLoader}
                unoptimized
                fill
                sizes={images.length === 1 ? "320px" : "176px"}
                src={url}
                alt={`说说图片 ${index + 1}`}
                loading={eager && index === 0 ? "eager" : "lazy"}
              />
            </AttachmentMedia>
            <AttachmentTrigger
              render={
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`查看 ${name}`}
                />
              }
            />
          </Attachment>
        );
      })}
    </AttachmentGroup>
  );
}
