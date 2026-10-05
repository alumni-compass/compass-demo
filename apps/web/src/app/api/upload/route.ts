/** Keeps an uploaded portrait in the browser session as a data URL. */
export async function POST(request: Request) {
  const bytes = await request.arrayBuffer();
  const type = request.headers.get("content-type") ?? "image/jpeg";
  const storageId = `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
  return Response.json({ storageId });
}
