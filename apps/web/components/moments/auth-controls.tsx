"use client"

import { Show, SignInButton, UserButton, useAuth } from "@clerk/nextjs"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"

import { getAuthStatus } from "./api"

export function AuthControls() {
  return (
    <div className="flex min-h-8 items-center">
      <Show when="signed-out">
        <SignInButton mode="modal">
          <Button type="button" variant="ghost">登录</Button>
        </SignInButton>
      </Show>
      <Show when="signed-in">
        <UserButton />
      </Show>
    </div>
  )
}

export function useAdminAccess() {
  const { isLoaded, isSignedIn, userId, getToken } = useAuth()
  const [checkedAccess, setCheckedAccess] = useState<{
    userId: string
    isAdmin: boolean
  } | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    if (!isLoaded || !isSignedIn || !userId) return () => controller.abort()

    void getToken()
      .then((token) => token
        ? getAuthStatus(token, controller.signal)
        : Promise.resolve({ authenticated: true as const, isAdmin: false }))
      .then((status) => {
        if (!controller.signal.aborted) {
          setCheckedAccess({ userId, isAdmin: status.isAdmin })
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setCheckedAccess({ userId, isAdmin: false })
        }
      })

    return () => controller.abort()
  }, [getToken, isLoaded, isSignedIn, userId])

  const hasCurrentResult = Boolean(userId && checkedAccess?.userId === userId)
  return {
    isAdmin: Boolean(isSignedIn && hasCurrentResult && checkedAccess?.isAdmin),
    isCheckingAdmin: !isLoaded || Boolean(isSignedIn && !hasCurrentResult),
    getToken,
  }
}
