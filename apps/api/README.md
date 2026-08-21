# Moments API

Cloudflare Worker + D1 backend for the personal Moments site. The OpenAPI contract is generated from the same Zod schemas that validate requests at runtime.

## Local setup

```bash
pnpm install
cd apps/api
Copy-Item .dev.vars.example .dev.vars
pnpm db:migrate:local
pnpm dev
```

Public endpoints work without Clerk configuration. To test authenticated endpoints, replace the placeholders in `.dev.vars` with the Clerk JWT public key and the administrator's immutable Clerk user ID.

## API contract

- Runtime document: `GET /openapi.json`
- Checked-in artifact: `openapi/openapi.json`
- 中文调试文档：`openapi/openapi.zh-CN.json`（可直接导入 Postman 或 ApiFox）
- Regenerate: `pnpm openapi:generate`
- Drift check: `pnpm openapi:check`

v2 (breaking) changes:

- `GET /api/v1/dates/{date}` was merged into `GET /api/v1/posts?date=YYYY-MM-DD`.
  The response is the cursor-page envelope plus `date` and `navigation`; `nextCursor` is `null` in date mode. `cursor`, `anchorDate` and `date` are mutually exclusive.
- `GET /api/v1/random` now returns the same envelope (`date` + `navigation`, `nextCursor: null`).
- `POST /api/v1/posts` and `PATCH` reject more than 18 image URLs.
- New `POST /api/v1/statistics/rebuild` (administrator only) recomputes the statistics aggregates from `posts`.

## Statistics aggregates

After `migrations/0004_derived_data_triggers.sql` is applied, the administrator-only `GET /api/v1/statistics` never scans `posts`. Its normal path reads three small tables created by `migrations/0002_create_statistics.sql` in one statement:

- `statistics_daily` — per Asia/Shanghai date: post count, character count, longest post, image count.
- `statistics_hourly` — post count per hour of day (0–23).
- `statistics_meta` — rebuild and derived-data schema markers.

Every create, update, soft-delete and restore is now one post mutation. D1 triggers update the statistics in the same SQLite transaction, so direct SQL maintenance cannot bypass the aggregates and readers never observe a post without its matching statistics. All character and image counts use SQLite `length()`/`json_array_length()` in both the triggers and rebuild path. The longest-post query is only rerun when an edit or deletion may have removed the current maximum.

`migrations/0003_create_public_post_slots.sql` creates `public_post_slots`, a dense `1..N` mapping maintained by the triggers in migration 0004. `GET /api/v1/random` samples one primary-key slot and retrieves that date and its navigation in one query; it no longer performs `COUNT(*) + OFFSET` over `posts`. Date detail and navigation are likewise returned by one query.

During the short Worker-first upgrade window, before migration 0004 exists, statistics fall back to a fresh direct aggregation from `posts` and random selection falls back to the legacy query. These paths are slower but never return stale data. Once the migration marker exists, they are not used.

Rebuild sources:

- `POST /api/v1/statistics/rebuild` (administrator bearer token) recomputes everything from `posts` and returns fresh statistics. The statistics page exposes this as a "重新计算统计数据" button for signed-in administrators.
- `migrations/0004_derived_data_triggers.sql` backfills all aggregates and random slots before enabling the version marker.

## D1 usage and cache consistency

D1 billing primarily counts rows read and written, not only Worker binding calls. The optimized queries therefore reduce both round trips and scanned rows. `db.batch()` is reserved for the administrator rebuild, where its statements must be transactional; D1 executes batch statements sequentially rather than in parallel.

All API responses use `Cache-Control: no-store`. Cloudflare Cache API entries are data-center-local and cannot be invalidated globally with one delete, so caching mutable posts or statistics could return stale data. Correctness is provided by indexed D1 reads and transactionally maintained derived tables instead.

## Rate limiting (dashboard)

Public read endpoints (`/api/v1/posts`, `/api/v1/random`) are unauthenticated and should be rate limited at the edge. In the Cloudflare dashboard open **Security → WAF → Rate limiting rules** and create a rule for your Worker zone:

- Field: URI Path, Operator: equals, Value: `/api/v1/posts` (add a further rule for `/api/v1/random`, or use a wildcard/regex such as `^/api/v1/(posts|random)` when available on your plan).
- Requests: e.g. 60 per 1 minute, counting period 60 seconds.
- Action: Managed Challenge (or Block).

Rules live in the dashboard, not in `wrangler.jsonc`.

## Upgrading an existing deployment to v2

1. From the repository root run `pnpm deploy:api`. Keep the complete command intact: Wrangler deploys the compatibility-aware Worker, then applies every pending migration. Already applied migrations are skipped.
2. Deploy the web app (Vercel). The frontend now calls `GET /api/v1/posts?date=...` instead of `/api/v1/dates/...`, so deploy the Worker first to avoid a window of 404s.
3. Optionally call the administrator-only rebuild endpoint once as a verification step. Migration 0004 already backfills the data, so this is not required for correctness.

No new environment variable is required. The schema migration is required and is applied by `pnpm deploy:api`; no manual data conversion is needed. The D1 snapshot/backup policy for your deployment should still be followed before any production migration.

Local development keeps its own D1 state under `.wrangler/state`. After pulling a release that adds migrations, re-run `pnpm db:migrate:local` in `apps/api` so the local database gets the new tables and triggers.

## Database

The D1 binding is `DB`, and its canonical Cloudflare database name is
`moments-db`. The repository intentionally omits the account-specific database
ID. On the first deployment, Wrangler creates `moments-db` automatically and
binds it as `DB`; the deployment script then applies every pending migration:

```bash
# From the repository root
pnpm deploy:api

# Or from apps/api
pnpm deploy
```

Use the same command for later deployments; already applied migrations are not
run again. In Cloudflare Workers Builds, set the deploy command to
`pnpm deploy:api` when the root directory is the repository root, or
`pnpm deploy` when the root directory is `apps/api`.

When deploying from a Git integration, the generated resource ID remains in
Cloudflare and is not written back to the repository.

For local development, create the local tables separately with
`pnpm db:migrate:local`.

Local Wrangler state is separate from the remote test database unless a command includes `--remote`.

## Production secrets

Set these interactively; do not place them in `wrangler.jsonc`:

```bash
wrangler secret put CLERK_JWT_KEY
wrangler secret put ADMIN_CLERK_USER_ID
wrangler secret put CFBED_API_TOKEN
```

Set `ALLOWED_ORIGIN` to the real frontend origin in the deployed Worker's
**Settings > Variables and Secrets** before production use. It is intentionally
absent from `wrangler.jsonc`; `keep_vars` prevents later deployments from
removing values managed in the Cloudflare dashboard.

Also set `CFBED_BASE_URL` to the origin of your CloudFlare ImgBed instance. The
token must have the ImgBed `delete` permission. Permanent deletion removes all
managed `/file/...` images first and deletes the D1 row only after ImgBed
confirms every deletion. A post with one managed image uses
`GET /api/manage/delete/{path}`; multiple images use at most 500 file IDs per
`POST /api/manage/delete/batch` request. A batch is trusted only when the
documented `deleted`/`failed` result accounts for every file. Non-standard or
partial acknowledgements are completed through the single-file endpoint before
the D1 row is removed. Configure the same ImgBed origin and token in Vercel for
uploads.
