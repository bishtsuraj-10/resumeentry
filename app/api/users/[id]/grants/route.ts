import { managementApi } from "@/lib/user-management";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return managementApi(request, "grants", "users.view", id);
}
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return managementApi(request, "grants", "users.manage_grants", id);
}
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return managementApi(request, "grants", "users.manage_grants", id);
}
