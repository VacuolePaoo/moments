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

The D1 binding is `DB`; the database name is `moments`. Apply migrations explicitly:

```bash
pnpm db:migrate:local
pnpm db:migrate:remote
```

Local Wrangler state is separate from the remote test database unless a command includes `--remote`.

## Production secrets

Set these interactively; do not place them in `wrangler.jsonc`:

```bash
wrangler secret put CLERK_JWT_KEY
wrangler secret put ADMIN_CLERK_USER_ID
```

Set the real frontend origin in the deployed Worker's `ALLOWED_ORIGIN` variable before production use.
