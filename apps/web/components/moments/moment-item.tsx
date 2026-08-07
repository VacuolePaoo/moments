"use client"

import { useEffect, useRef, useState } from "react"
import { EllipsisIcon, PencilIcon, Trash2Icon } from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

import { updatePost, type MomentPost } from "./api"
import { editDraftKey, readDraft, removeDraft, writeDraft } from "./drafts"
import { TextContent } from "./text-content"

interface MomentItemProps {
  post: MomentPost
  isAdmin: boolean
  getToken: () => Promise<string | null>
  showEdited?: boolean
  onUpdated: (post: MomentPost) => void
  onDelete: (post: MomentPost) => void
}

export function MomentItem({
  post,
  isAdmin,
  getToken,
  showEdited = false,
  onUpdated,
  onDelete,
}: MomentItemProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [content, setContent] = useState(post.content)
  const [isSaving, setIsSaving] = useState(false)
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false)
  const [draftBaseUpdatedAt, setDraftBaseUpdatedAt] = useState(post.updatedAt)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const draftKey = editDraftKey(post.id)

  useEffect(() => {
    if (!isEditing || content === post.content) return
    const timer = window.setTimeout(() => {
      if (!writeDraft(draftKey, content, draftBaseUpdatedAt)) {
        toast.add({ type: "error", description: "编辑草稿保存失败。" })
      }
    }, 5000)
    return () => window.clearTimeout(timer)
  }, [content, draftBaseUpdatedAt, draftKey, isEditing, post.content])

  function beginEditing() {
    const draft = readDraft(draftKey)
    const restoredContent = draft?.content ?? post.content
    const baseUpdatedAt = draft?.baseUpdatedAt ?? post.updatedAt

    setContent(restoredContent)
    setDraftBaseUpdatedAt(baseUpdatedAt)
    setIsEditing(true)
    if (draft) {
      toast.add({ type: "info", description: "已恢复编辑草稿。" })
      if (draft.baseUpdatedAt && draft.baseUpdatedAt !== post.updatedAt) {
        toast.add({
          type: "warning",
          description: "服务器原内容已发生变化，请确认后再保存。",
        })
      }
    }
    window.requestAnimationFrame(() => textareaRef.current?.focus())
  }

  function requestCancel() {
    if (content === post.content && !readDraft(draftKey)) {
      setIsEditing(false)
      return
    }
    setCancelDialogOpen(true)
  }

  function keepDraftAndCancel() {
    writeDraft(draftKey, content, draftBaseUpdatedAt)
    setCancelDialogOpen(false)
    setIsEditing(false)
  }

  function discardDraftAndCancel() {
    removeDraft(draftKey)
    setContent(post.content)
    setCancelDialogOpen(false)
    setIsEditing(false)
  }

  async function save() {
    if (!content.trim() || isSaving) return
    setIsSaving(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("登录状态已失效。")
      const updated = await updatePost(post.id, content, token)
      removeDraft(draftKey)
      setContent(updated.content)
      setDraftBaseUpdatedAt(updated.updatedAt)
      setIsEditing(false)
      onUpdated(updated)
    } catch {
      toast.add({ type: "error", description: "保存失败，请稍后重试。" })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <article className="relative min-w-0">
      {isAdmin && !isEditing ? (
        <div className="absolute -top-1 right-0">
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
                <DropdownMenuItem variant="destructive" onClick={() => onDelete(post)}>
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
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={`moment-edit-${post.id}`} className="sr-only">
                编辑说说
              </FieldLabel>
              <Textarea
                ref={textareaRef}
                id={`moment-edit-${post.id}`}
                value={content}
                onChange={(event) => setContent(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                    event.preventDefault()
                    void save()
                  }
                }}
                className="min-h-32 resize-none text-base leading-6 md:text-base"
                disabled={isSaving}
              />
            </Field>
            <Field orientation="horizontal" className="justify-end">
              <Button type="button" variant="outline" onClick={requestCancel} disabled={isSaving}>
                取消
              </Button>
              <Button type="submit" disabled={!content.trim() || isSaving}>
                {isSaving ? <Spinner data-icon="inline-start" /> : null}
                {isSaving ? "保存中" : "保存"}
              </Button>
            </Field>
          </FieldGroup>
        </form>
      ) : (
        <div className={isAdmin ? "pr-10" : undefined}>
          <TextContent content={post.content} />
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
              可以保留当前编辑草稿，或丢弃草稿并恢复服务器内容。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>继续编辑</AlertDialogCancel>
            <AlertDialogAction variant="outline" onClick={keepDraftAndCancel}>
              保留草稿
            </AlertDialogAction>
            <AlertDialogAction variant="destructive" onClick={discardDraftAndCancel}>
              丢弃草稿
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  )
}
