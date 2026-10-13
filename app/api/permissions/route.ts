import { managementApi } from "@/lib/user-management";
export async function GET(request: Request) {
  return managementApi(request, "catalog", "roles.view");
}
