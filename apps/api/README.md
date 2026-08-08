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
database name or ID. On the first `wrangler deploy`, Wrangler automatically
creates a D1 database and binds it to the Worker. When deploying from a Git
integration, the generated resource ID remains in Cloudflare and is not written
back to the repository.

Apply migrations explicitly after the first deployment:

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

Set `ALLOWED_ORIGIN` to the real frontend origin in the deployed Worker's
**Settings > Variables and Secrets** before production use. It is intentionally
absent from `wrangler.jsonc`; `keep_vars` prevents later deployments from
removing values managed in the Cloudflare dashboard.
