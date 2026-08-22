export async function GET() {
  return Response.json(
    {
      fileUploadConfigured: Boolean(process.env.CFBED_BASE_URL),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
