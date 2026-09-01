import { ApiError } from "../lib/errors";
import type { AppSettings, UpdateSettings, WeekdayLanguage } from "../schemas";

interface SettingsRow {
  show_site_name: number;
  site_name: string;
  site_description: string;
  statistics_enabled: number;
  random_enabled: number;
  rss_enabled: number;
  content_public: number;
  voice_enabled: number;
  page_size: number;
  share_toolbar_enabled: number;
  weekday_language: string;
  updated_at: string;
}

function toBoolean(value: number): boolean {
  return value === 1;
}

function toWeekdayLanguage(value: string): WeekdayLanguage {
  switch (value) {
    case "en":
    case "ja":
      return value;
    default:
      return "zh";
  }
}

// Migration 0005 requires at least one stored character. A single space keeps
// existing deployments compatible while the API exposes an intentional blank.
export function siteNameForStorage(value: string): string {
  return value.length === 0 ? " " : value;
}

function toAppSettings(row: SettingsRow): AppSettings {
  return {
    site: {
      showName: toBoolean(row.show_site_name),
      name: row.site_name.trim(),
      description: row.site_description,
    },
    features: {
      statistics: toBoolean(row.statistics_enabled),
      random: toBoolean(row.random_enabled),
      rss: toBoolean(row.rss_enabled),
    },
    content: {
      public: toBoolean(row.content_public),
      voice: toBoolean(row.voice_enabled),
      pageSize: row.page_size,
      shareToolbar: toBoolean(row.share_toolbar_enabled),
    },
    format: {
      weekdayLanguage: toWeekdayLanguage(row.weekday_language),
    },
    updatedAt: row.updated_at,
  };
}

export async function getAppSettings(db: D1Database): Promise<AppSettings> {
  const row = await db
    .prepare(
      `SELECT
         show_site_name,
         site_name,
         site_description,
         statistics_enabled,
         random_enabled,
         rss_enabled,
         content_public,
         voice_enabled,
         page_size,
         share_toolbar_enabled,
         weekday_language,
         updated_at
       FROM settings
       WHERE id = 1`,
    )
    .first<SettingsRow>();

  if (!row) {
    throw new ApiError(
      503,
      "SETTINGS_NOT_INITIALIZED",
      "Application settings are not initialized.",
    );
  }
  return toAppSettings(row);
}

export async function updateAppSettings(
  db: D1Database,
  update: UpdateSettings,
): Promise<AppSettings> {
  const current = await getAppSettings(db);
  const next: AppSettings = {
    site: {
      showName: update.site?.showName ?? current.site.showName,
      name: update.site?.name ?? current.site.name,
      description: update.site?.description ?? current.site.description,
    },
    features: {
      statistics: update.features?.statistics ?? current.features.statistics,
      random: update.features?.random ?? current.features.random,
      rss: update.features?.rss ?? current.features.rss,
    },
    content: {
      public: update.content?.public ?? current.content.public,
      voice: update.content?.voice ?? current.content.voice,
      pageSize: update.content?.pageSize ?? current.content.pageSize,
      shareToolbar:
        update.content?.shareToolbar ?? current.content.shareToolbar,
    },
    format: {
      weekdayLanguage:
        update.format?.weekdayLanguage ?? current.format.weekdayLanguage,
    },
    updatedAt: new Date().toISOString(),
  };

  const result = await db
    .prepare(
      `UPDATE settings
       SET
         show_site_name = ?,
         site_name = ?,
         site_description = ?,
         statistics_enabled = ?,
         random_enabled = ?,
         rss_enabled = ?,
         content_public = ?,
         voice_enabled = ?,
         page_size = ?,
         share_toolbar_enabled = ?,
         weekday_language = ?,
         updated_at = ?
       WHERE id = 1`,
    )
    .bind(
      Number(next.site.showName),
      siteNameForStorage(next.site.name),
      next.site.description,
      Number(next.features.statistics),
      Number(next.features.random),
      Number(next.features.rss),
      Number(next.content.public),
      Number(next.content.voice),
      next.content.pageSize,
      Number(next.content.shareToolbar),
      next.format.weekdayLanguage,
      next.updatedAt,
    )
    .run();

  if (result.meta.changes !== 1) {
    throw new ApiError(
      500,
      "SETTINGS_UPDATE_FAILED",
      "Settings were not updated.",
    );
  }
  return next;
}

export function assertFeatureEnabled(
  enabled: boolean,
  featureName: "statistics" | "random" | "rss",
): void {
  if (enabled) return;
  throw new ApiError(
    403,
    "FEATURE_DISABLED",
    `The ${featureName} feature is disabled.`,
  );
}
