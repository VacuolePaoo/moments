import { workerApiBaseUrl } from "@/lib/worker-api";

export async function GET() {
  let response: Response;
  try {
    response = await fetch(`${workerApiBaseUrl()}/rss.xml`, {
      headers: { Accept: "application/rss+xml" },
      cache: "no-store",
    });
  } catch {
    return new Response("RSS 服务暂时不可用。", { status: 502 });
  }

  if (response.body === null) {
    return new Response("RSS 服务暂时不可用。", { status: 502 });
  }

  if (!response.ok) {
    return new Response(response.body, {
      status: response.status,
      headers: {
        "Content-Type":
          response.headers.get("Content-Type") ??
          "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  return new Response(response.body, {
    status: 200,
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
