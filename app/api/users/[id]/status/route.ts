import { managementApi } from "@/lib/user-management";
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return managementApi(request, "status", "users.set_active", id);
}
