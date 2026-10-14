import { managementApi } from "@/lib/user-management";
export async function PATCH(
  request: Request,
  context: { params: Promise<{ key: string }> },
) {
  const { key } = await context.params;
  return managementApi(request, "role", "roles.manage", key);
}
export async function DELETE(
  request: Request,
  context: { params: Promise<{ key: string }> },
) {
  const { key } = await context.params;
  return managementApi(request, "role", "roles.manage", key);
}
