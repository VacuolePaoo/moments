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
- Regenerate: `pnpm openapi:generate`
- Drift check: `pnpm openapi:check`

## Database

The D1 binding is `DB`. The repository intentionally does not contain a D1
database name or ID. The deployment script first lets Wrangler create and bind
the database, then applies every pending migration to create or update its
tables:

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
