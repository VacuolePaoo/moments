const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

function shanghaiDateTimestamp(value: string): number | null {
  if (!ISO_DATE_PATTERN.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00+08:00`);
  if (!Number.isFinite(timestamp)) return null;
  const normalized = new Date(timestamp + SHANGHAI_OFFSET_MS)
    .toISOString()
    .slice(0, 10);
  return normalized === value ? timestamp : null;
}

export function toShanghaiDate(isoTimestamp: string): string {
  const timestamp = Date.parse(isoTimestamp);
  if (!Number.isFinite(timestamp)) {
    throw new Error("Invalid ISO timestamp.");
  }
  return new Date(timestamp + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
}

export function isValidShanghaiDate(value: string): boolean {
  return shanghaiDateTimestamp(value) !== null;
}

export function getShanghaiDayBounds(value: string): {
  startAt: string;
  endAt: string;
} {
  const start = shanghaiDateTimestamp(value);
  if (start === null) {
    throw new Error("Invalid Asia/Shanghai calendar date.");
  }
  return {
    startAt: new Date(start).toISOString(),
    endAt: new Date(start + DAY_MS).toISOString(),
  };
}

export function getShanghaiToday(now: Date): string {
  return toShanghaiDate(now.toISOString());
}

export function daysBetweenShanghaiDates(start: string, end: string): number {
  const startAt = shanghaiDateTimestamp(start);
  const endAt = shanghaiDateTimestamp(end);
  if (startAt === null || endAt === null) {
    throw new Error("Invalid Asia/Shanghai calendar date.");
  }
  return Math.round((endAt - startAt) / DAY_MS);
}
