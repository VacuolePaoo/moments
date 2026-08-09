"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  EllipsisIcon,
  ImagePlusIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { updatePost, type MomentPost } from "./api";
import { editDraftKey, readDraft, removeDraft, writeDraft } from "./drafts";
import {
  EditableImageAttachments,
  MomentImages,
  editableImagesFromFiles,
  editableImagesFromUrls,
  releaseEditableImage,
  uploadEditableImages,
  type EditableImage,
} from "./image-attachments";
import { TextContent } from "./text-content";

interface MomentItemProps {
  post: MomentPost;
  isAdmin: boolean;
  getToken: () => Promise<string | null>;
  showEdited?: boolean;
  eagerImages?: boolean;
  onUpdated: (post: MomentPost) => void;
  onDelete: (post: MomentPost) => void;
}

function hasImageChanges(images: EditableImage[], original: string[]) {
  return (
    images.length !== original.length ||
    images.some((image, index) => image.url !== original[index])
  );
}

export function MomentItem({
  post,
  isAdmin,
  getToken,
  showEdited = false,
  eagerImages = false,
  onUpdated,
  onDelete,
}: MomentItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [content, setContent] = useState(post.content);
  const [images, setImages] = useState<EditableImage[]>(() =>
    editableImagesFromUrls(post.images),
  );
  const [isSaving, setIsSaving] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [draftBaseUpdatedAt, setDraftBaseUpdatedAt] = useState(post.updatedAt);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imagesRef = useRef(images);
  const draftKey = editDraftKey(post.id);

  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  useEffect(() => {
    if (!isEditing || !content || content === post.content) return;
    const timer = window.setTimeout(() => {
      if (!writeDraft(draftKey, content, draftBaseUpdatedAt)) {
        toast.add({ type: "error", description: "编辑草稿保存失败。" });
      }
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [content, draftBaseUpdatedAt, draftKey, isEditing, post.content]);

  useEffect(
    () => () => {
      imagesRef.current.forEach(releaseEditableImage);
    },
    [],
  );

  function replaceImages(next: EditableImage[]) {
    imagesRef.current.forEach(releaseEditableImage);
    setImages(next);
  }

  function beginEditing() {
    const draft = readDraft(draftKey);
    const restoredContent = draft?.content ?? post.content;
    const baseUpdatedAt = draft?.baseUpdatedAt ?? post.updatedAt;

    setContent(restoredContent);
    replaceImages(editableImagesFromUrls(post.images));
    setDraftBaseUpdatedAt(baseUpdatedAt);
    setIsEditing(true);
    if (draft?.baseUpdatedAt && draft.baseUpdatedAt !== post.updatedAt) {
      toast.add({
        type: "warning",
        description: "服务器原内容已发生变化，请确认后再保存。",
      });
    }
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function handleContentChange(value: string) {
    setContent(value);
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

  function updateImage(id: string, values: Partial<EditableImage>) {
    setImages((current) =>
      current.map((image) =>
        image.id === id ? { ...image, ...values } : image,
      ),
    );
  }

  function removeImage(image: EditableImage) {
    releaseEditableImage(image);
    setImages((current) => current.filter((item) => item.id !== image.id));
  }

  function requestCancel() {
    if (
      content === post.content &&
      !hasImageChanges(images, post.images) &&
      !readDraft(draftKey)
    ) {
      setIsEditing(false);
      return;
    }
    setCancelDialogOpen(true);
  }

  function resetEditorImages() {
    replaceImages(editableImagesFromUrls(post.images));
  }

  function keepDraftAndCancel() {
    if (content) writeDraft(draftKey, content, draftBaseUpdatedAt);
    else removeDraft(draftKey);
    resetEditorImages();
    setCancelDialogOpen(false);
    setIsEditing(false);
  }

  function discardDraftAndCancel() {
    removeDraft(draftKey);
    setContent(post.content);
    resetEditorImages();
    setCancelDialogOpen(false);
    setIsEditing(false);
  }

  async function save() {
    if ((!content.trim() && images.length === 0) || isSaving) return;
    setIsSaving(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("登录状态已失效。");
      const imageUrls = await uploadEditableImages(images, token, updateImage);
      const updated = await updatePost(post.id, content, imageUrls, token);
      removeDraft(draftKey);
      setContent(updated.content);
      replaceImages(editableImagesFromUrls(updated.images));
      setDraftBaseUpdatedAt(updated.updatedAt);
      setIsEditing(false);
      onUpdated(updated);
    } catch (error) {
      toast.add({
        type: "error",
        description:
          error instanceof Error ? error.message : "保存失败，请稍后重试。",
      });
    } finally {
      setIsSaving(false);
    }
  }

  const canSave = content.trim().length > 0 || images.length > 0;

  return (
    <article className="group/moment relative min-w-0">
      {isAdmin && !isEditing ? (
        <div className="absolute -top-1 right-0 md:invisible md:opacity-0 md:group-hover/moment:visible md:group-hover/moment:opacity-100 md:group-focus-within/moment:visible md:group-focus-within/moment:opacity-100">
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger
                render={
                  <DropdownMenuTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="更多操作"
                      />
                    }
                  />
                }
              >
                <EllipsisIcon />
              </TooltipTrigger>
              <TooltipContent>更多操作</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={beginEditing}>
                  <PencilIcon />
                  编辑
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => onDelete(post)}
                >
                  <Trash2Icon />
                  删除
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}

      {isEditing ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <EditableImageAttachments
            images={images}
            disabled={isSaving}
            onRemove={removeImage}
          />
          <Label htmlFor={`moment-edit-${post.id}`} className="sr-only">
            编辑说说
          </Label>
          <Textarea
            ref={textareaRef}
            id={`moment-edit-${post.id}`}
            value={content}
            onChange={(event) => handleContentChange(event.target.value)}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                event.preventDefault();
                void save();
              }
            }}
            className="min-h-32 resize-none text-base leading-6 md:text-base"
            disabled={isSaving}
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
                    disabled={isSaving}
                    onClick={() => fileInputRef.current?.click()}
                  />
                }
              >
                <ImagePlusIcon />
              </TooltipTrigger>
              <TooltipContent>添加图片</TooltipContent>
            </Tooltip>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={requestCancel}
                disabled={isSaving}
              >
                取消
              </Button>
              <Button type="submit" disabled={!canSave || isSaving}>
                {isSaving ? <Spinner data-icon="inline-start" /> : null}
                {isSaving ? "保存中" : "保存"}
              </Button>
            </div>
          </div>
        </form>
      ) : (
        <div className={isAdmin ? "pr-10" : undefined}>
          <div className="flex flex-col gap-4">
            <MomentImages images={post.images} eager={eagerImages} />
            {post.content ? <TextContent content={post.content} /> : null}
          </div>
          {showEdited && post.edited ? (
            <p className="mt-2 text-sm text-muted-foreground">已编辑</p>
          ) : null}
        </div>
      )}

      <AlertDialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>取消编辑？</AlertDialogTitle>
            <AlertDialogDescription>
              可以保留文字草稿，或丢弃草稿并恢复服务器内容。未保存的图片不会保留。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>继续编辑</AlertDialogCancel>
            <AlertDialogAction variant="outline" onClick={keepDraftAndCancel}>
              保留草稿
            </AlertDialogAction>
            <AlertDialogAction
              variant="destructive"
              onClick={discardDraftAndCancel}
            >
              丢弃草稿
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  );
}
