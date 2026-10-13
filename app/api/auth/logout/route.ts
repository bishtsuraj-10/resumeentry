import { checkOrigin, clearSession } from "@/lib/auth";
export async function POST(request: Request) {
  const forbidden = checkOrigin(request);
  if (forbidden) return forbidden;
  await clearSession();
  return Response.json({ ok: true });
}
