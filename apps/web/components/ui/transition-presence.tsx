"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

const EXIT_DURATION_MS = 200;

export function TransitionPresence({
  show,
  children,
  className,
  animateOnMount = true,
  collapse = false,
}: {
  show: boolean;
  children: ReactNode;
  className?: string;
  animateOnMount?: boolean;
  collapse?: boolean;
}) {
  const [isMounted, setIsMounted] = useState(show);
  const [isVisible, setIsVisible] = useState(show && !animateOnMount);
  const [isSettled, setIsSettled] = useState(show && !animateOnMount);
  const skipInitialAnimation = useRef(show && !animateOnMount);

  useEffect(() => {
    if (skipInitialAnimation.current) {
      skipInitialAnimation.current = false;
      return;
    }

    let mountFrame: number | undefined;
    let showFrame: number | undefined;
    let hideFrame: number | undefined;
    let hideTimer: number | undefined;
    let settleTimer: number | undefined;

    if (show) {
      mountFrame = window.requestAnimationFrame(() => {
        setIsMounted(true);
        showFrame = window.requestAnimationFrame(() => {
          setIsVisible(true);
          if (collapse) {
            setIsSettled(false);
            settleTimer = window.setTimeout(
              () => setIsSettled(true),
              EXIT_DURATION_MS,
            );
          }
        });
      });
    } else {
      hideFrame = window.requestAnimationFrame(() => {
        setIsVisible(false);
        if (collapse) setIsSettled(false);
        hideTimer = window.setTimeout(
          () => setIsMounted(false),
          EXIT_DURATION_MS,
        );
      });
    }

    return () => {
      if (mountFrame !== undefined) window.cancelAnimationFrame(mountFrame);
      if (showFrame !== undefined) window.cancelAnimationFrame(showFrame);
      if (hideFrame !== undefined) window.cancelAnimationFrame(hideFrame);
      if (hideTimer !== undefined) window.clearTimeout(hideTimer);
      if (settleTimer !== undefined) window.clearTimeout(settleTimer);
    };
  }, [collapse, show]);

  if (!isMounted) return null;

  return (
    <div
      aria-hidden={!isVisible}
      inert={!isVisible ? true : undefined}
      className={cn(
        collapse
          ? cn(
              "grid transition-[grid-template-rows,opacity,transform] duration-200 ease-out motion-reduce:transition-none",
              isVisible && isSettled ? "overflow-visible" : "overflow-hidden",
            )
          : "transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none",
        isVisible
          ? cn(
              "translate-y-0 scale-100 opacity-100",
              collapse ? "grid-rows-[1fr]" : undefined,
            )
          : cn(
              "pointer-events-none translate-y-1 scale-[0.98] opacity-0",
              collapse ? "grid-rows-[0fr]" : undefined,
            ),
        className,
      )}
    >
      {collapse ? <div className="min-h-0">{children}</div> : children}
    </div>
  );
}
