/** Auth routes are unused in the standalone preview. */
export function GET() {
  return Response.json({ standalone: true });
}

export function POST() {
  return Response.json({ standalone: true });
}
