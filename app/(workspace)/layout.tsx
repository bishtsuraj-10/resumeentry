import { redirect } from "next/navigation";
import { Suspense } from "react";
import { session } from "@/lib/auth";
import { WorkspaceAccessProvider } from "./workspace-access";
import WorkspaceShell from "./workspace-shell";

async function RequireSession({ children }: { children: React.ReactNode }) {
  const current = await session();
  if (!current) redirect("/login");
  const account = {
    id: current.id,
    name: current.name,
    email: current.email,
    role: current.role,
    permissions: current.permissions,
  };
  return (
    <WorkspaceAccessProvider account={account}>
      <WorkspaceShell>{children}</WorkspaceShell>
    </WorkspaceAccessProvider>
  );
}

export default function WorkspaceLayout({ children }: LayoutProps<"/">) {
  return (
    <Suspense
      fallback={
        <main className="tool-page workspace-loading" role="status">
          Loading workspace…
        </main>
      }
    >
      <RequireSession>{children}</RequireSession>
    </Suspense>
  );
}
