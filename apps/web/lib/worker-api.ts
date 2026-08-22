export function isSecureEndpoint(url: URL): boolean {
  return (
    url.protocol === "https:" ||
    (url.protocol === "http:" &&
      (url.hostname === "localhost" ||
        url.hostname === "127.0.0.1" ||
        url.hostname === "[::1]"))
  );
}

export function workerApiBaseUrl(): string {
  const configured = (
    process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8787"
  ).replace(/\/$/u, "");
  const url = new URL(configured);
  if (!isSecureEndpoint(url)) {
    throw new Error("Worker API 地址必须使用 HTTPS（本地开发除外）。");
  }
  return configured;
}
