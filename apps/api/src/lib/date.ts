const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

export function toShanghaiDate(isoTimestamp: string): string {
  const timestamp = Date.parse(isoTimestamp);
  if (!Number.isFinite(timestamp)) {
    throw new Error("Invalid ISO timestamp.");
  }
  return new Date(timestamp + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
}

export function isValidShanghaiDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const start = Date.parse(`${value}T00:00:00+08:00`);
  return (
    Number.isFinite(start) &&
    toShanghaiDate(new Date(start).toISOString()) === value
  );
}

export function getShanghaiDayBounds(value: string): {
  startAt: string;
  endAt: string;
} {
  if (!isValidShanghaiDate(value)) {
    throw new Error("Invalid Asia/Shanghai calendar date.");
  }
  const start = Date.parse(`${value}T00:00:00+08:00`);
  return {
    startAt: new Date(start).toISOString(),
    endAt: new Date(start + DAY_MS).toISOString(),
  };
}
