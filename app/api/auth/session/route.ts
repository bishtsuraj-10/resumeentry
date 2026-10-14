import { session } from "@/lib/auth";
export async function GET() {
  const current = await session();
  return current
    ? Response.json(
        {
          id: current.id,
          name: current.name,
          email: current.email,
          role: current.role,
          permissions: current.permissions,
        },
        { headers: { "cache-control": "no-store" } },
      )
    : Response.json({ error: "Unauthorized" }, { status: 401 });
}
