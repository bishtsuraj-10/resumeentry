import { managementApi } from "@/lib/user-management";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return managementApi(request, "user", "users.view", id);
}
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return managementApi(request, "user", "users.update", id);
}
