import { managementApi } from "@/lib/user-management";
export async function PUT(
  request: Request,
  context: { params: Promise<{ key: string }> },
) {
  const { key } = await context.params;
  return managementApi(request, "rolePermissions", "roles.manage", key);
}
