import type { MomentStatistics } from "../schemas";
import { daysBetweenShanghaiDates } from "./date";

export interface StatisticsDay {
  date: string;
  count: number;
  characterCount: number;
  longestPostCharacters: number;
  imageCount: number;
}

export interface StatisticsHour {
  hour: number;
  count: number;
}

type Paragraph = MomentStatistics["administratorNarrative"][number];
type Segment = Paragraph["segments"][number];
type NumericCopy = string | ((value: number) => string);
type FrequencyLevel = "high" | "medium" | "low";
type TimePeriod =
  | "lateNight"
  | "earlyMorning"
  | "morning"
  | "noon"
  | "afternoon"
  | "evening";

interface StatisticsSummary {
  first: StatisticsDay;
  totalPosts: number;
  activeDays: number;
  totalCharacters: number;
  longestPostCharacters: number;
  imageCount: number;
  lifetimeDays: number;
  averageInterval: number;
  peakMonth: { month: string; count: number };
  longestStreak: number;
  longestSilence: number;
  currentYearPeak: StatisticsDay | null;
}

const MINIMUM_ACTIVE_DAYS = 6;
const COLLECTION_PENDING_COPY = "坚持下去，Moments正在为你统计数据";

// 1. 发布频率
const frequencyCopy: Record<FrequencyLevel, readonly NumericCopy[]> = {
  high: [
    (interval) =>
      `你似乎很喜欢使用 Moments 记录生活，平均每 ${String(interval)} 天就会留下一篇 moment`,
    "对你来说，记录已经成为生活的一部分，只要有事情发生，你就会写一篇 moment",
    (interval) =>
      `你是个相当勤快的记录者，每 ${String(interval)} 天就会留下一篇 moment，很少让这里长时间保持安静`,
  ],
  medium: [
    "你并不会时时刻刻记录生活，但每每发生让你印象深刻的事时，你还是会来这里留下一篇 moment",
    "你似乎更喜欢挑一些值得留下的时刻，让自己在多年后，还能回想起这天的所思与所做，而不是把每天发生的一切都写下来",
  ],
  low: [
    "你并不习惯频繁记录生活，大多数时候，你只是偶尔想起这里，然后留下些什么",
    (interval) => `你平均每 ${String(interval)} 天，才会挑选一个值得留下的瞬间`,
    "这里并不是很热闹，但你的每一次出现，似乎都有一些自己的理由",
  ],
};

// 2. 发布时间习惯
const timeCopy: Record<TimePeriod, readonly string[]> = {
  lateNight: [
    "你似乎更喜欢在夜深人静时记录生活，白天没说完的话，到了这个时候才有机会写下",
    "深夜是你最常出现的时间，一天终于安静下来，你也终于有时间写下那些白天没有记录的事情",
    "当一天终于安静下来，你反而更容易想起一些值得留下的东西",
    "夜深以后，这里更容易出现你的身影。也许有些瞬间，本来就需要安静下来以后才看得见",
  ],
  earlyMorning: [
    "对你来说，清晨似乎是一个适合记录的时间。窗外刚刚亮起来，这里已经有了你的第一句话",
    "比起深夜，你更常在清晨出现。看起来有些故事，你喜欢从一天的开头说起",
    "你常常在早上发布 moment，是把它当做每天的 to-do 用了吗？",
    "你似乎喜欢在早上回顾自己的前一天，然后来到这里留下一篇 moment",
  ],
  morning: [
    "上午是你比较常出现的时间。一天刚刚进入正轨，这里也会偶尔留下你的身影",
    "你经常在上午记录一些事情，似乎喜欢趁一天还没有过半时，把发生的事情先记下来",
  ],
  noon: [
    "你偶尔会在午后的空隙里留下 moment，像是在忙碌的一天中偷偷按下暂停键",
    "你常常在午后的间隙出现，一天进行到一半，刚好有一些东西想留下",
  ],
  afternoon: [
    "下午是你比较活跃的时候，一天还没有结束，但已经有不少事情值得被记录下来",
    "你经常在下午写下 moment，在一天接近尾声的时候，回头看一眼已经发生的事情",
    "你的下午并不总是安静的，这里留下了不少下午的痕迹",
  ],
  evening: [
    "晚间是你最常出现的时间之一：一天的事情告一段落，你才终于有时间把一些东西写下来",
    "你经常在晚上整理一天的碎片，白天的事到了这个时候，才慢慢变成了值得记录的东西",
  ],
};

// 3. 连续记录与沉默
const longStreakCopy: readonly NumericCopy[] = [
  (days) => `你最长连续记录了 ${String(days)} 天，那段时间里，你是这里的常客`,
  (days) =>
    `你似乎很擅长让记录成为一种习惯，最长的一次连续记录持续了 ${String(days)} 天`,
];

const longSilenceCopy: readonly NumericCopy[] = [
  (days) =>
    `你最长的一次沉默持续了 ${String(days)} 天，那段时间你似乎很忙碌，或者……什么都没发生`,
  (days) =>
    `你曾经消失过 ${String(days)} 天，至于那段时间发生了什么，只有你自己知道`,
  (days) =>
    `这里最长的一段空白有 ${String(days)} 天，没有文字，没有照片，只有生活继续向前`,
];

const TIME_PERIOD_ORDER: readonly TimePeriod[] = [
  "lateNight",
  "earlyMorning",
  "morning",
  "noon",
  "afternoon",
  "evening",
];

function normal(text: string): Segment {
  return { text, bold: false };
}

function bold(text: string | number): Segment {
  return { text: String(text), bold: true };
}

function paragraph(...segments: Segment[]): Paragraph {
  return { segments };
}

function dynamicSegments(text: string): Segment[] {
  return text
    .split(/(\d+)/u)
    .filter(Boolean)
    .map((part) => (/^\d+$/u.test(part) ? bold(part) : normal(part)));
}

function randomItem<T>(items: readonly T[]): T {
  const sample = new Uint32Array(1);
  crypto.getRandomValues(sample);
  const selected = items[(sample[0] ?? 0) % items.length];
  if (selected === undefined) throw new Error("Copy collection is empty.");
  return selected;
}

function randomCopy(options: readonly NumericCopy[], value: number): string {
  const selected = randomItem(options);
  return typeof selected === "function" ? selected(value) : selected;
}

function formatDate(value: string): string {
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) throw new Error("Invalid statistics date.");
  return `${year}年${String(Number(month))}月${String(Number(day))}日`;
}

function formatMonth(value: string): string {
  const [year, month] = value.split("-");
  if (!year || !month) throw new Error("Invalid statistics month.");
  return `${year}年${String(Number(month))}月`;
}

function timePeriodForHour(hour: number): TimePeriod {
  if (hour >= 22 || hour < 5) return "lateNight";
  if (hour < 8) return "earlyMorning";
  if (hour < 12) return "morning";
  if (hour < 14) return "noon";
  if (hour < 19) return "afternoon";
  return "evening";
}

function dominantTimePeriod(hours: StatisticsHour[]): TimePeriod {
  const counts: Record<TimePeriod, number> = {
    lateNight: 0,
    earlyMorning: 0,
    morning: 0,
    noon: 0,
    afternoon: 0,
    evening: 0,
  };
  for (const { hour, count } of hours) {
    counts[timePeriodForHour(hour)] += count;
  }
  return TIME_PERIOD_ORDER.reduce((best, period) =>
    counts[period] > counts[best] ? period : best,
  );
}

function frequencyText(interval: number): string {
  const level: FrequencyLevel =
    interval <= 1 ? "high" : interval <= 3 ? "medium" : "low";
  return randomCopy(frequencyCopy[level], interval);
}

function streakText(days: number): string {
  if (days >= 20) return randomCopy(longStreakCopy, days);
  if (days >= 10) {
    return `你曾经连续记录了 ${String(days)} 天，看来一旦开始记录，就很容易一直写下去`;
  }
  return "你并不强制自己每天一定要写点什么。有想法的时候认真写，没有的时候，也就让生活自然过去";
}

function silenceText(days: number): string | null {
  if (days > 30) {
    return "你并不是总记着记录，有时候一个月甚至更久，这里什么都没有，而生活依然向前";
  }
  if (days >= 15) return randomCopy(longSilenceCopy, days);
  if (days >= 5) {
    return `你很少让这里长时间保持安静，最长的一次空白也只有 ${String(days)} 天`;
  }
  return null;
}

function summarizeDays(
  days: StatisticsDay[],
  today: string,
): StatisticsSummary {
  const first = days[0];
  if (!first) throw new Error("Cannot summarize empty statistics.");

  const currentYear = today.slice(0, 4);
  const monthCounts = new Map<string, number>();
  let totalPosts = 0;
  let totalCharacters = 0;
  let longestPostCharacters = 0;
  let imageCount = 0;
  let currentStreak = 0;
  let longestStreak = 0;
  let longestSilence = 0;
  let currentYearPeak: StatisticsDay | null = null;
  let previousDate: string | undefined;

  for (const day of days) {
    totalPosts += day.count;
    totalCharacters += day.characterCount;
    longestPostCharacters = Math.max(
      longestPostCharacters,
      day.longestPostCharacters,
    );
    imageCount += day.imageCount;

    const month = day.date.slice(0, 7);
    monthCounts.set(month, (monthCounts.get(month) ?? 0) + day.count);

    const distance = previousDate
      ? daysBetweenShanghaiDates(previousDate, day.date)
      : null;
    currentStreak = distance === 1 ? currentStreak + 1 : 1;
    longestStreak = Math.max(longestStreak, currentStreak);
    if (distance !== null) {
      longestSilence = Math.max(longestSilence, distance - 1);
    }

    if (
      day.date.startsWith(`${currentYear}-`) &&
      (!currentYearPeak || day.count > currentYearPeak.count)
    ) {
      currentYearPeak = day;
    }
    previousDate = day.date;
  }

  const latest = days.at(-1);
  if (latest) {
    longestSilence = Math.max(
      longestSilence,
      daysBetweenShanghaiDates(latest.date, today),
    );
  }

  const peakMonth = [...monthCounts].reduce(
    (peak, [month, count]) => (count > peak.count ? { month, count } : peak),
    { month: first.date.slice(0, 7), count: 0 },
  );
  const lifetimeDays = Math.max(
    1,
    daysBetweenShanghaiDates(first.date, today) + 1,
  );

  return {
    first,
    totalPosts,
    activeDays: days.length,
    totalCharacters,
    longestPostCharacters,
    imageCount,
    lifetimeDays,
    averageInterval: Math.max(1, Math.round(lifetimeDays / totalPosts)),
    peakMonth,
    longestStreak,
    longestSilence,
    currentYearPeak,
  };
}

// 以下生成器严格对应页面中的段落顺序。
function introductionParagraph(summary: StatisticsSummary): Paragraph {
  return paragraph(
    normal("自 "),
    bold(formatDate(summary.first.date)),
    normal(" 以来，你一共发布了 "),
    bold(summary.totalPosts),
    normal(" 篇 moment，记录了 "),
    bold(summary.activeDays),
    normal(" 天生活"),
  );
}

function frequencyParagraph(summary: StatisticsSummary): Paragraph {
  return paragraph(
    ...dynamicSegments(
      `${frequencyText(summary.averageInterval)}。最活跃的时候是在 `,
    ),
    bold(formatMonth(summary.peakMonth.month)),
    normal("，一个月里写下了 "),
    bold(summary.peakMonth.count),
    normal(" 篇 moment"),
  );
}

function timeHabitParagraph(hours: StatisticsHour[]): Paragraph {
  const period = dominantTimePeriod(hours);
  return paragraph(normal(randomItem(timeCopy[period])));
}

function continuityParagraph(summary: StatisticsSummary): Paragraph {
  const silence = silenceText(summary.longestSilence);
  const copy = [
    streakText(summary.longestStreak),
    ...(silence ? [silence] : []),
    "每当你想要记录时，总会留下些什么，对吧……",
  ].join("。");
  return paragraph(...dynamicSegments(copy));
}

function textStatisticsParagraph(summary: StatisticsSummary): Paragraph {
  return paragraph(
    normal("从第一篇 moment 到现在的这 "),
    bold(summary.lifetimeDays),
    normal(" 天里，你一共写下了 "),
    bold(summary.totalCharacters),
    normal(" 个字，最长的一篇有 "),
    bold(summary.longestPostCharacters),
    normal(" 个字"),
  );
}

function imageParagraph(summary: StatisticsSummary): Paragraph {
  if (summary.imageCount === 0) {
    return paragraph(
      normal("你在这里留下的moment，似乎只有文字，看来你是一个喜欢写作的人"),
    );
  }
  return paragraph(
    normal("除了文字，你还留下了 "),
    bold(summary.imageCount),
    normal(
      " 张照片。看来对于你来说，记录生活并不只有一种方式——有时候是一句话，有时候是一张照片，也有时候是一个突然想留下来的瞬间",
    ),
  );
}

function currentYearParagraph(summary: StatisticsSummary): Paragraph | null {
  const peak = summary.currentYearPeak;
  if (!peak) return null;
  return paragraph(
    bold("今年"),
    normal("，你发布最多的一天是 "),
    bold(formatDate(peak.date)),
    normal("，一共写下了 "),
    bold(peak.count),
    normal(" 篇 moment。看来那一天发生了很多事情，或许只是恰好有很多话想说"),
  );
}

function closingParagraph(summary: StatisticsSummary): Paragraph {
  return paragraph(
    normal("从 "),
    bold(formatDate(summary.first.date)),
    normal(
      " 到今天，你已经留下了这么多故事。今天的统计就到这里，而明天，又会是一个新的开始",
    ),
  );
}

function buildCompleteNarrative(
  days: StatisticsDay[],
  hours: StatisticsHour[],
  today: string,
): Paragraph[] {
  const summary = summarizeDays(days, today);
  const currentYear = currentYearParagraph(summary);
  return [
    introductionParagraph(summary),
    frequencyParagraph(summary),
    timeHabitParagraph(hours),
    continuityParagraph(summary),
    textStatisticsParagraph(summary),
    imageParagraph(summary),
    ...(currentYear ? [currentYear] : []),
    closingParagraph(summary),
  ];
}

export function buildAdministratorNarrative(
  days: StatisticsDay[],
  hours: StatisticsHour[],
  today: string,
): Paragraph[] {
  if (days.length === 0) return [];
  if (days.length < MINIMUM_ACTIVE_DAYS) {
    return [paragraph(normal(COLLECTION_PENDING_COPY))];
  }
  return buildCompleteNarrative(days, hours, today);
}
