import { managementApi } from "@/lib/user-management";
export async function GET(request: Request) {
  return managementApi(request, "users", "users.view");
}
export async function POST(request: Request) {
  return managementApi(request, "users", "users.create");
}
