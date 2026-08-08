# Moments Web

Next.js frontend for Moments. It renders the public feed and date pages, while
Clerk administrators can publish, edit, upload images and manage the recycle
bin.

## Local setup

```powershell
Copy-Item .env.example .env.local
pnpm dev
```

Configure the Clerk keys and `NEXT_PUBLIC_API_BASE_URL`. Image uploads are
proxied by `POST /api/uploads`; set these server-only variables in Vercel:

```text
CFBED_BASE_URL=https://your-imgbed.example
CFBED_API_TOKEN=your-upload-token
CFBED_UPLOAD_FOLDER=moments
```

`CFBED_API_TOKEN` must not use the `NEXT_PUBLIC_` prefix. The proxy accepts only
image MIME types and verifies the caller as the Moments administrator through
the Worker before forwarding a file to CloudFlare ImgBed.
