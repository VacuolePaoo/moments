import { getShanghaiToday } from "../lib/date";
import {
  buildAdministratorNarrative,
  type StatisticsDay,
  type StatisticsHour,
} from "../lib/statistics";
import type { MomentStatistics } from "../schemas";

interface StatisticsSnapshotRow {
  initialized: number;
  daily_json: string;
  hourly_json: string;
}

interface DailyAggregateJson {
  date: string;
  count: number;
  characterCount: number;
  longestPostCharacters: number;
  imageCount: number;
}

interface HourlyAggregateJson {
  hour: number;
  count: number;
}

const DERIVED_DATA_VERSION_KEY = "derived_data_version";
const REBUILT_AT_KEY = "rebuilt_at";

const statisticsProjectionSql = `
  SELECT
    (SELECT initialized FROM derived_data) AS initialized,
    (
      SELECT json_group_array(json_object(
        'date', date,
        'count', post_count,
        'characterCount', character_count,
        'longestPostCharacters', longest_post_characters,
        'imageCount', image_count
      ))
      FROM (
        SELECT date, post_count, character_count,
               longest_post_characters, image_count
        FROM daily_source
        WHERE post_count > 0
        ORDER BY date ASC
      )
    ) AS daily_json,
    (
      SELECT json_group_array(json_object(
        'hour', hour,
        'count', post_count
      ))
      FROM (
        SELECT hour, post_count
        FROM hourly_source
        WHERE post_count > 0
        ORDER BY hour ASC
      )
    ) AS hourly_json`;

const statisticsSnapshotSql = `
  WITH derived_data AS MATERIALIZED (
    SELECT EXISTS(
      SELECT 1 FROM statistics_meta WHERE key = ? AND value = '1'
    ) AS initialized
  ),
  daily_source AS MATERIALIZED (
    SELECT date, post_count, character_count,
           longest_post_characters, image_count
    FROM statistics_daily
  ),
  hourly_source AS MATERIALIZED (
    SELECT hour, post_count
    FROM statistics_hourly
  )
  ${statisticsProjectionSql}`;

const legacyStatisticsSnapshotSql = `
  WITH derived_data AS MATERIALIZED (
    SELECT 0 AS initialized
  ),
  daily_source AS MATERIALIZED (
    SELECT date(created_at, '+8 hours') AS date,
           COUNT(*) AS post_count,
           COALESCE(SUM(length(content)), 0) AS character_count,
           COALESCE(MAX(length(content)), 0) AS longest_post_characters,
           COALESCE(SUM(json_array_length(images_json)), 0) AS image_count
    FROM posts
    WHERE deleted_at IS NULL
    GROUP BY date(created_at, '+8 hours')
  ),
  hourly_source AS MATERIALIZED (
    SELECT CAST(strftime('%H', created_at, '+8 hours') AS INTEGER) AS hour,
           COUNT(*) AS post_count
    FROM posts
    WHERE deleted_at IS NULL
    GROUP BY strftime('%H', created_at, '+8 hours')
  )
  ${statisticsProjectionSql}`;

function isMissingStatisticsSchemaError(error: unknown): boolean {
  return /no such table:\s*(?:main\.)?statistics_/iu.test(String(error));
}

function parseJsonArray(value: string, label: string): unknown[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) {
    throw new Error(`D1 returned invalid ${label} aggregate JSON.`);
  }
  return parsed;
}

function parseDailyAggregates(value: string): StatisticsDay[] {
  return parseJsonArray(value, "daily").map((item) => {
    if (
      typeof item !== "object" ||
      item === null ||
      !("date" in item) ||
      !("count" in item) ||
      !("characterCount" in item) ||
      !("longestPostCharacters" in item) ||
      !("imageCount" in item) ||
      typeof item.date !== "string" ||
      typeof item.count !== "number" ||
      typeof item.characterCount !== "number" ||
      typeof item.longestPostCharacters !== "number" ||
      typeof item.imageCount !== "number"
    ) {
      throw new Error("D1 returned an invalid daily aggregate row.");
    }
    return {
      date: item.date,
      count: item.count,
      characterCount: item.characterCount,
      longestPostCharacters: item.longestPostCharacters,
      imageCount: item.imageCount,
    } satisfies DailyAggregateJson;
  });
}

function parseHourlyAggregates(value: string): StatisticsHour[] {
  return parseJsonArray(value, "hourly").map((item) => {
    if (
      typeof item !== "object" ||
      item === null ||
      !("hour" in item) ||
      !("count" in item) ||
      typeof item.hour !== "number" ||
      typeof item.count !== "number"
    ) {
      throw new Error("D1 returned an invalid hourly aggregate row.");
    }
    return {
      hour: item.hour,
      count: item.count,
    } satisfies HourlyAggregateJson;
  });
}

function renderStatistics(
  snapshot: StatisticsSnapshotRow,
  now: Date,
): MomentStatistics {
  const detailedDays = parseDailyAggregates(snapshot.daily_json);
  const hours = parseHourlyAggregates(snapshot.hourly_json);
  return {
    days: detailedDays.map(({ date, count }) => ({ date, count })),
    administratorNarrative: buildAdministratorNarrative(
      detailedDays,
      hours,
      getShanghaiToday(now),
    ),
  };
}

function snapshotStatement(db: D1Database): D1PreparedStatement {
  return db.prepare(statisticsSnapshotSql).bind(DERIVED_DATA_VERSION_KEY);
}

function snapshotFromResult(
  result: D1Result<StatisticsSnapshotRow> | undefined,
): StatisticsSnapshotRow {
  const snapshot = result?.results[0];
  if (snapshot === undefined) {
    throw new Error("D1 did not return the statistics snapshot.");
  }
  return snapshot;
}

async function readLegacyStatisticsSnapshot(
  db: D1Database,
): Promise<StatisticsSnapshotRow> {
  const snapshot = await db
    .prepare(legacyStatisticsSnapshotSql)
    .first<StatisticsSnapshotRow>();
  if (snapshot === null) {
    throw new Error("D1 did not return the fallback statistics snapshot.");
  }
  return snapshot;
}

export async function rebuildStatisticsAggregates(
  db: D1Database,
  now = new Date(),
): Promise<MomentStatistics> {
  const results = await db.batch<StatisticsSnapshotRow>([
    db.prepare("DELETE FROM statistics_daily"),
    db.prepare("DELETE FROM statistics_hourly"),
    db.prepare("DELETE FROM public_post_slots"),
    db.prepare(
      `INSERT INTO statistics_daily
         (date, post_count, character_count, longest_post_characters, image_count)
       SELECT date(created_at, '+8 hours'),
              COUNT(*),
              COALESCE(SUM(length(content)), 0),
              COALESCE(MAX(length(content)), 0),
              COALESCE(SUM(json_array_length(images_json)), 0)
       FROM posts
       WHERE deleted_at IS NULL
       GROUP BY date(created_at, '+8 hours')`,
    ),
    db.prepare(
      `INSERT INTO statistics_hourly (hour, post_count)
       SELECT CAST(strftime('%H', created_at, '+8 hours') AS INTEGER), COUNT(*)
       FROM posts
       WHERE deleted_at IS NULL
       GROUP BY strftime('%H', created_at, '+8 hours')`,
    ),
    db.prepare(
      `INSERT INTO public_post_slots (slot, post_id)
       SELECT ROW_NUMBER() OVER (ORDER BY id), id
       FROM posts
       WHERE deleted_at IS NULL
       ORDER BY id`,
    ),
    db
      .prepare(
        `INSERT INTO statistics_meta (key, value)
         VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .bind(REBUILT_AT_KEY, now.toISOString()),
    db
      .prepare(
        `INSERT INTO statistics_meta (key, value)
         VALUES (?, '1')
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .bind(DERIVED_DATA_VERSION_KEY),
    snapshotStatement(db),
  ]);

  return renderStatistics(snapshotFromResult(results.at(-1)), now);
}

export async function getMomentStatistics(
  db: D1Database,
  now = new Date(),
): Promise<MomentStatistics> {
  let snapshot: StatisticsSnapshotRow | null;
  try {
    snapshot = await snapshotStatement(db).first<StatisticsSnapshotRow>();
  } catch (error) {
    if (!isMissingStatisticsSchemaError(error)) throw error;
    return renderStatistics(await readLegacyStatisticsSnapshot(db), now);
  }
  if (snapshot === null) {
    throw new Error("D1 did not return the statistics snapshot.");
  }
  if (snapshot.initialized !== 1) {
    return renderStatistics(await readLegacyStatisticsSnapshot(db), now);
  }
  return renderStatistics(snapshot, now);
}
