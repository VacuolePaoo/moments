"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";

import { getPublicSettings, type AppSettings } from "./api";

interface RuntimeConfig {
  fileUploadConfigured: boolean;
}

interface SiteSettingsContextValue {
  settings: AppSettings | null;
  fileUploadConfigured: boolean;
  isLoading: boolean;
  error: string | null;
  applySettings: (settings: AppSettings) => void;
  refresh: () => Promise<void>;
}

const SiteSettingsContext = createContext<SiteSettingsContextValue | null>(
  null,
);

async function getRuntimeConfig(signal?: AbortSignal): Promise<RuntimeConfig> {
  const response = await fetch("/api/runtime-config", {
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error("Frontend runtime configuration failed.");
  return (await response.json()) as RuntimeConfig;
}

export function SiteSettingsProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [fileUploadConfigured, setFileUploadConfigured] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    const [settingsResult, runtimeResult] = await Promise.allSettled([
      getPublicSettings(signal),
      getRuntimeConfig(signal),
    ]);

    if (settingsResult.status === "fulfilled") {
      setSettings(settingsResult.value);
    }
    if (runtimeResult.status === "fulfilled") {
      setFileUploadConfigured(runtimeResult.value.fileUploadConfigured);
    }

    const failed =
      settingsResult.status === "rejected" ||
      runtimeResult.status === "rejected";
    setError(failed ? "站点配置加载失败。" : null);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [load]);

  useEffect(() => {
    if (!settings) return;
    const siteName = settings.site.name || "Moments";
    if (pathname === "/") {
      document.title = siteName;
    } else {
      const pageTitle = document.title.split(" · ")[0] || siteName;
      document.title = `${pageTitle} · ${siteName}`;
    }
  }, [pathname, settings]);

  useEffect(() => {
    if (!settings) return;
    const selector = 'link[data-moments-rss="true"]';
    const existing = document.head.querySelector<HTMLLinkElement>(selector);
    if (!settings.features.rss) {
      existing?.remove();
      return;
    }
    if (existing) return;
    const link = document.createElement("link");
    link.rel = "alternate";
    link.type = "application/rss+xml";
    link.title = `${settings.site.name || "Moments"} RSS`;
    link.href = "/rss.xml";
    link.dataset.momentsRss = "true";
    document.head.append(link);
    return () => link.remove();
  }, [settings]);

  const value = useMemo<SiteSettingsContextValue>(
    () => ({
      settings,
      fileUploadConfigured,
      isLoading,
      error,
      applySettings: setSettings,
      refresh: () => load(),
    }),
    [error, fileUploadConfigured, isLoading, load, settings],
  );

  return (
    <SiteSettingsContext.Provider value={value}>
      {children}
    </SiteSettingsContext.Provider>
  );
}

export function useSiteSettings() {
  const value = useContext(SiteSettingsContext);
  if (!value) {
    throw new Error("useSiteSettings 必须在 SiteSettingsProvider 中使用。");
  }
  return value;
}
