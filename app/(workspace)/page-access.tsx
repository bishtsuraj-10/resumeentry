import "server-only";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { session } from "@/lib/auth";
import { hasPermission, type Permission } from "@/lib/permissions";
import { type WorkspaceAccount } from "@/lib/workspace-access";
import { WorkspaceAccessProvider } from "./workspace-access";
import NoAccess from "./no-access-state";
export { default as NoAccess } from "./no-access-state";
async function CheckPage({
  permission,
  render,
}: {
  permission?: Permission;
  render: (
    account: WorkspaceAccount,
  ) => React.ReactNode | Promise<React.ReactNode>;
}) {
  const current = await session();
  if (!current) redirect("/login");
  const account: WorkspaceAccount = {
    id: current.id,
    name: current.name,
    email: current.email,
    role: current.role,
    permissions: current.permissions,
  };
  if (permission && !hasPermission(account, permission))
    return <NoAccess account={account} forbidden />;
  return (
    <WorkspaceAccessProvider account={account} requiredPermission={permission}>
      {await render(account)}
    </WorkspaceAccessProvider>
  );
}
export default function PageAccess(props: {
  permission?: Permission;
  render: (
    account: WorkspaceAccount,
  ) => React.ReactNode | Promise<React.ReactNode>;
}) {
  return (
    <Suspense
      fallback={
        <main className="tool-page table-state" role="status">
          Checking access…
        </main>
      }
    >
      <CheckPage {...props} />
    </Suspense>
  );
}
