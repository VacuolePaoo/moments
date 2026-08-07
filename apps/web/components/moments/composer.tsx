"use client"

import { forwardRef, useEffect, useRef, useState } from "react"
import { EllipsisIcon, Trash2Icon } from "lucide-react"

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
import { Card, CardContent, CardFooter } from "@/components/ui/card"
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

import { createPost, type MomentPost } from "./api"
import { publishDraftKey, readDraft, removeDraft, writeDraft } from "./drafts"

interface ComposerProps {
  getToken: () => Promise<string | null>
  onCreated: (post: MomentPost) => void
}

export const Composer = forwardRef<HTMLTextAreaElement, ComposerProps>(
  function Composer({ getToken, onCreated }, ref) {
    const [content, setContent] = useState("")
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [draftStatus, setDraftStatus] = useState("保存草稿")
    const [clearDialogOpen, setClearDialogOpen] = useState(false)
    const statusTimer = useRef<number | null>(null)
    const draftKey = publishDraftKey()

    useEffect(() => {
      const draft = readDraft(draftKey)
      if (!draft?.content) return
      setContent(draft.content)
      toast.add({ type: "info", description: "已恢复草稿。" })
    }, [draftKey])

    useEffect(() => {
      if (!content) return
      const timer = window.setTimeout(() => {
        setDraftStatus("自动保存")
        const saved = writeDraft(draftKey, content)
        if (statusTimer.current) window.clearTimeout(statusTimer.current)
        statusTimer.current = window.setTimeout(
          () => setDraftStatus(saved ? "保存成功" : "保存草稿"),
          400
        )
        if (!saved) toast.add({ type: "error", description: "草稿保存失败。" })
      }, 5000)
      return () => window.clearTimeout(timer)
    }, [content, draftKey])

    useEffect(() => () => {
      if (statusTimer.current) window.clearTimeout(statusTimer.current)
    }, [])

    function saveDraftManually() {
      const saved = writeDraft(draftKey, content)
      setDraftStatus(saved ? "保存成功" : "保存草稿")
      if (!saved) toast.add({ type: "error", description: "草稿保存失败。" })
    }

    function clearDraft() {
      setContent("")
      removeDraft(draftKey)
      setDraftStatus("保存草稿")
      setClearDialogOpen(false)
    }

    async function publish() {
      if (!content.trim() || isSubmitting) return
      setIsSubmitting(true)
      try {
        const token = await getToken()
        if (!token) throw new Error("登录状态已失效。")
        const post = await createPost(content, token)
        onCreated(post)
        setContent("")
        removeDraft(draftKey)
        setDraftStatus("保存草稿")
      } catch {
        toast.add({ type: "error", description: "发布失败，请稍后重试。" })
      } finally {
        setIsSubmitting(false)
      }
    }

    return (
      <>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void publish()
          }}
        >
          <Card>
            <CardContent>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="moment-composer" className="sr-only">
                    发布说说
                  </FieldLabel>
                  <Textarea
                    ref={ref}
                    id="moment-composer"
                    value={content}
                    onChange={(event) => {
                      setContent(event.target.value)
                      setDraftStatus("保存草稿")
                    }}
                    onKeyDown={(event) => {
                      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                        event.preventDefault()
                        void publish()
                      }
                    }}
                    className="min-h-32 resize-none text-base leading-6 md:text-base"
                  />
                </Field>
              </FieldGroup>
            </CardContent>
            <CardFooter className="justify-between gap-4">
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  onClick={saveDraftManually}
                  disabled={!content || isSubmitting}
                >
                  {draftStatus}
                </Button>
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
                              aria-label="更多草稿操作"
                            />
                          }
                        />
                      }
                    >
                      <EllipsisIcon />
                    </TooltipTrigger>
                    <TooltipContent>更多草稿操作</TooltipContent>
                  </Tooltip>
                  <DropdownMenuContent align="start">
                    <DropdownMenuGroup>
                      <DropdownMenuItem
                        variant="destructive"
                        disabled={!content}
                        onClick={() => setClearDialogOpen(true)}
                      >
                        <Trash2Icon />
                        清空草稿
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <Button type="submit" disabled={!content.trim() || isSubmitting}>
                {isSubmitting ? <Spinner data-icon="inline-start" /> : null}
                {isSubmitting ? "发布中" : "发布"}
              </Button>
            </CardFooter>
          </Card>
        </form>

        <AlertDialog open={clearDialogOpen} onOpenChange={setClearDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>清空草稿？</AlertDialogTitle>
              <AlertDialogDescription>清空后无法从当前浏览器恢复。</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={clearDraft}>
                清空
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    )
  }
)
