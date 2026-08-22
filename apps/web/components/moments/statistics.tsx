"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import {
  CalendarHeatmap,
  CalendarHeatmapBlock,
  CalendarHeatmapBody,
  type Activity,
} from "@/components/heatmap/calendar-heatmap";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import {
  getMomentStatistics,
  MomentsApiError,
  retryRead,
  type MomentStatistics,
} from "./api";
import { useAdminAccess } from "./auth-controls";
import { MomentsShell } from "./moments-shell";
import { PageTitle } from "./page-title";
import { TextContent } from "./text-content";
import { useSiteSettings } from "./site-settings";

const heatmapLabels = {
  months: [
    "1月",
    "2月",
    "3月",
    "4月",
    "5月",
    "6月",
    "7月",
    "8月",
    "9月",
    "10月",
    "11月",
    "12月",
  ],
  weekdays: ["日", "一", "二", "三", "四", "五", "六"],
  cellLabel: "{{date}}：{{value}} 篇 Moment",
  heatmapLabel: "{{year}} 年 Moments 发布热力图",
};

const heatmapColors = { scale: "var(--color-green-600)" };

function formatShortDate(date: string): string {
  const [year, month, day] = date.split("-");
  return `${year}年${Number(month)}月${Number(day)}日`;
}

function activityForYear(
  days: MomentStatistics["days"],
  year: number,
): Activity[] {
  const activity = days
    .filter((day) => day.date.startsWith(`${year}-`))
    .map((day) => ({ date: day.date, value: day.count }));
  const byDate = new Map(activity.map((day) => [day.date, day]));
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;
  if (!byDate.has(start)) byDate.set(start, { date: start, value: 0 });
  if (!byDate.has(end)) byDate.set(end, { date: end, value: 0 });
  return [...byDate.values()].sort((left, right) =>
    left.date.localeCompare(right.date),
  );
}

export function MomentsStatistics() {
  const router = useRouter();
  const { isAdmin, isCheckingAdmin, getToken } = useAdminAccess();
  const { settings, isLoading: isSettingsLoading } = useSiteSettings();
  const [statistics, setStatistics] = useState<MomentStatistics | null>(null);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) throw new Error("登录状态已失效。");
      const value = await retryRead(() => getMomentStatistics(token));
      setStatistics(value);
      setError(null);
    } catch (loadError) {
      setError(
        loadError instanceof MomentsApiError &&
          loadError.code === "FEATURE_DISABLED"
          ? "统计功能已关闭"
          : "统计信息加载失败，请稍后重试。",
      );
    } finally {
      setIsLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    if (isCheckingAdmin || isSettingsLoading || !settings) return;
    if (!isAdmin) {
      router.replace("/");
      return;
    }
    if (!settings.features.statistics) {
      const timer = window.setTimeout(() => {
        setIsLoading(false);
        setError("统计功能已关闭");
      }, 0);
      return () => window.clearTimeout(timer);
    }
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [
    isAdmin,
    isCheckingAdmin,
    isSettingsLoading,
    load,
    router,
    settings,
  ]);

  const years = useMemo(
    () =>
      statistics
        ? [
            ...new Set(
              statistics.days.map((day) => Number(day.date.slice(0, 4))),
            ),
          ].sort((left, right) => right - left)
        : [],
    [statistics],
  );
  const activeYear = selectedYear ?? years[0] ?? null;

  if (!isAdmin) {
    return (
      <MomentsShell>
        {isCheckingAdmin ? <StatisticsSkeleton /> : null}
      </MomentsShell>
    );
  }

  return (
    <MomentsShell>
      <PageTitle>统计信息</PageTitle>

      {isLoading ? <StatisticsSkeleton /> : null}

      {!isLoading && error ? (
        <div className="flex items-center gap-3" role="alert">
          <p className="text-base leading-6 text-muted-foreground">{error}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setIsLoading(true);
              void load();
            }}
          >
            重试
          </Button>
        </div>
      ) : null}

      {!isLoading && !error && statistics?.days.length === 0 ? (
        <p className="text-base leading-6 text-muted-foreground">
          还没有可统计的内容
        </p>
      ) : null}

      {!isLoading && !error && statistics && activeYear !== null ? (
        <div className="flex flex-col gap-10">
          <Tabs
            value={String(activeYear)}
            onValueChange={(value) => setSelectedYear(Number(value))}
          >
            <TabsList variant="line" aria-label="统计年份">
              {years.map((year) => (
                <TabsTrigger key={year} value={String(year)}>
                  {year}
                </TabsTrigger>
              ))}
            </TabsList>
            {years.map((year) => (
              <TabsContent key={year} value={String(year)}>
                <CalendarHeatmap
                  data={activityForYear(statistics.days, year)}
                  weekStart={1}
                  levels={5}
                  blockSize={12}
                  blockMargin={4}
                  blockRadius={2}
                  continuousMonths
                  colors={heatmapColors}
                  labels={heatmapLabels}
                  className="w-full p-0"
                >
                  <CalendarHeatmapBody hideYearLabels>
                    {({ activity, dayIndex, weekIndex }) => (
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <CalendarHeatmapBlock
                              activity={activity}
                              dayIndex={dayIndex}
                              weekIndex={weekIndex}
                            />
                          }
                        />
                        <TooltipContent>
                          {formatShortDate(activity.date)}，发布{" "}
                          {activity.value} 篇 Moment
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </CalendarHeatmapBody>
                </CalendarHeatmap>
              </TabsContent>
            ))}
          </Tabs>

          <TextContent
            paragraphs={statistics.administratorNarrative}
            lineHeight="relaxed"
          />
        </div>
      ) : null}
    </MomentsShell>
  );
}

function StatisticsSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-label="正在加载统计信息">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-36 w-full" />
      <Skeleton className="h-12 w-4/5" />
    </div>
  );
}
