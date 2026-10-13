import { managementApi } from "@/lib/user-management";
export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return managementApi(request, "assignment", "users.assign_role", id);
}
