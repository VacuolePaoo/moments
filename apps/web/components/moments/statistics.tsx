"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCwIcon } from "lucide-react";

import {
  CalendarHeatmap,
  CalendarHeatmapBlock,
  CalendarHeatmapBody,
  type Activity,
} from "@/components/heatmap/calendar-heatmap";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import {
  getMomentStatistics,
  rebuildStatistics,
  retryRead,
  type MomentStatistics,
} from "./api";
import { useAdminAccess } from "./auth-controls";
import { MomentsShell } from "./moments-shell";
import { PageTitle } from "./page-title";
import { TextContent } from "./text-content";

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
  const { isAdmin, isCheckingAdmin, getToken } = useAdminAccess();
  const [statistics, setStatistics] = useState<MomentStatistics | null>(null);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRebuilding, setIsRebuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const value = await retryRead(() => getMomentStatistics());
      setStatistics(value);
      setError(null);
    } catch {
      setError("统计信息加载失败，请稍后重试。");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const rebuild = useCallback(async () => {
    const token = await getToken();
    if (!token || isRebuilding) return;
    setIsRebuilding(true);
    try {
      const value = await rebuildStatistics(token);
      setStatistics(value);
      setError(null);
      toast.add({ type: "success", description: "统计数据已重新计算。" });
    } catch (rebuildError) {
      toast.add({
        type: "error",
        description:
          rebuildError instanceof Error
            ? rebuildError.message
            : "统计重建失败，请稍后重试。",
      });
    } finally {
      setIsRebuilding(false);
    }
  }, [getToken, isRebuilding]);

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

  return (
    <MomentsShell>
      <div className="mb-12 flex items-center justify-between gap-4">
        <PageTitle className="mb-0">统计信息</PageTitle>
        {isAdmin ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label="重新计算统计数据"
                  disabled={isRebuilding}
                  onClick={() => {
                    void rebuild();
                  }}
                />
              }
            >
              {isRebuilding ? <Spinner /> : <RefreshCwIcon />}
            </TooltipTrigger>
            <TooltipContent>重新计算统计数据</TooltipContent>
          </Tooltip>
        ) : null}
      </div>

      {isLoading || isCheckingAdmin ? <StatisticsSkeleton /> : null}

      {!isLoading && !isCheckingAdmin && error ? (
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

      {!isLoading &&
      !isCheckingAdmin &&
      !error &&
      statistics?.days.length === 0 ? (
        <p className="text-base leading-6 text-muted-foreground">
          还没有可统计的内容
        </p>
      ) : null}

      {!isLoading &&
      !isCheckingAdmin &&
      !error &&
      statistics &&
      activeYear !== null ? (
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

          {isAdmin ? (
            <TextContent
              paragraphs={statistics.administratorNarrative}
              lineHeight="relaxed"
            />
          ) : null}
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
