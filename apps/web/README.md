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

When `CFBED_BASE_URL` is absent, the publish and edit forms do not render the
add-image control. Multiple selected images upload through a bounded queue with
up to three in flight; results are written back by selection index, so D1 URL
order never depends on ImgBed response order.

The frontend exposes `GET /rss.xml` and streams the Worker's RSS 2.0 document,
which contains public Moments from the most recent 20 Asia/Shanghai calendar
days.

The administrator settings page groups system, feature and content settings in
full-width shadcn Tabs. Settings are stored in D1 and enforced by Worker routes;
the frontend loads them before rendering the bottom toolbar so feature icons do
not appear and disappear after first paint.
