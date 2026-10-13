import { managementApi } from "@/lib/user-management";
export async function GET(request: Request) {
  return managementApi(request, "roles", "roles.view");
}
export async function POST(request: Request) {
  return managementApi(request, "roles", "roles.manage");
}
