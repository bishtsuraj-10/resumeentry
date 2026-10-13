import { managementApi } from "@/lib/user-management";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return managementApi(request, "password", "users.reset_password", id);
}
