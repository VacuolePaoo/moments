"use client";

import { SignInButton, UserButton, useAuth, useUser } from "@clerk/nextjs";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { LogInIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { TransitionPresence } from "@/components/ui/transition-presence";
import { cn } from "@/lib/utils";

import { getAuthStatus } from "./api";

interface AdminAccess {
  isAdmin: boolean;
  isCheckingAdmin: boolean;
  getToken: () => Promise<string | null>;
}

const AdminAccessContext = createContext<AdminAccess | null>(null);

export function AuthControls({ compact = false }: { compact?: boolean }) {
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const userName =
    user?.fullName ??
    user?.username ??
    user?.primaryEmailAddress?.emailAddress ??
    "当前用户";

  return (
    <div
      className={cn(
        "grid items-center justify-center",
        compact ? "size-11" : "min-h-8",
      )}
    >
      <TransitionPresence
        show={Boolean(isLoaded && !isSignedIn)}
        animateOnMount={false}
        className="col-start-1 row-start-1 flex items-center justify-center"
      >
        <SignInButton mode="modal">
          <Button
            type="button"
            variant="ghost"
            size={compact ? "icon-lg" : "default"}
            className={compact ? "size-11 rounded-full!" : undefined}
            aria-label={compact ? "登录" : undefined}
          >
            {compact ? <LogInIcon /> : "登录"}
          </Button>
        </SignInButton>
      </TransitionPresence>
      <TransitionPresence
        show={Boolean(isLoaded && isSignedIn)}
        animateOnMount={false}
        className="col-start-1 row-start-1 flex items-center justify-center"
      >
        {compact ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <span className="flex size-11 items-center justify-center rounded-full" />
              }
            >
              <UserButton
                appearance={{
                  elements: {
                    rootBox: "size-11",
                    userButtonTrigger: "size-11 rounded-full",
                    userButtonBox: "size-11",
                    avatarBox: "size-11!",
                    avatarImage: "size-full!",
                  },
                }}
              />
            </TooltipTrigger>
            <TooltipContent>{userName}</TooltipContent>
          </Tooltip>
        ) : (
          <UserButton />
        )}
      </TransitionPresence>
    </div>
  );
}

export function AdminAccessProvider({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, userId, getToken } = useAuth();
  const [checkedAccess, setCheckedAccess] = useState<{
    userId: string;
    isAdmin: boolean;
  } | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    if (!isLoaded || !isSignedIn || !userId) return () => controller.abort();

    void getToken()
      .then((token) =>
        token
          ? getAuthStatus(token, controller.signal)
          : Promise.resolve({ authenticated: true as const, isAdmin: false }),
      )
      .then((status) => {
        if (!controller.signal.aborted) {
          setCheckedAccess({ userId, isAdmin: status.isAdmin });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setCheckedAccess({ userId, isAdmin: false });
        }
      });

    return () => controller.abort();
  }, [getToken, isLoaded, isSignedIn, userId]);

  const hasCurrentResult = Boolean(userId && checkedAccess?.userId === userId);
  const value = useMemo(
    () => ({
      isAdmin: Boolean(
        isSignedIn && hasCurrentResult && checkedAccess?.isAdmin,
      ),
      isCheckingAdmin: !isLoaded || Boolean(isSignedIn && !hasCurrentResult),
      getToken,
    }),
    [checkedAccess?.isAdmin, getToken, hasCurrentResult, isLoaded, isSignedIn],
  );

  return (
    <AdminAccessContext.Provider value={value}>
      {children}
    </AdminAccessContext.Provider>
  );
}

export function useAdminAccess() {
  const access = useContext(AdminAccessContext);
  if (!access) {
    throw new Error("useAdminAccess 必须在 AdminAccessProvider 中使用。");
  }
  return access;
}
