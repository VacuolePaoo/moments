function workerBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8787"
  ).replace(/\/$/u, "");
}

export async function GET() {
  let response: Response;
  try {
    response = await fetch(`${workerBaseUrl()}/rss.xml`, {
      headers: { Accept: "application/rss+xml" },
      cache: "no-store",
    });
  } catch {
    return new Response("RSS 服务暂时不可用。", { status: 502 });
  }

  if (!response.ok || response.body === null) {
    return new Response("RSS 服务暂时不可用。", { status: 502 });
  }

  return new Response(response.body, {
    status: 200,
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
