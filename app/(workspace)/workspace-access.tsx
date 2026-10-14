"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { hasPermission, type Permission } from "@/lib/permissions";
import type { WorkspaceAccount } from "@/lib/workspace-access";
import NoAccess from "./no-access-state";
const Access = createContext<WorkspaceAccount | null>(null);
export function WorkspaceAccessProvider({
  account,
  children,
  requiredPermission,
}: {
  account: WorkspaceAccount;
  children: React.ReactNode;
  requiredPermission?: Permission;
}) {
  const pathname = usePathname();
  const [refreshed, setRefreshed] = useState<{
    source: WorkspaceAccount;
    value: WorkspaceAccount;
  } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const response = await fetch("/api/auth/session", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (response.status === 401) {
          setRefreshed({
            source: account,
            value: { ...account, permissions: [] },
          });
          window.location.replace("/login");
          return;
        }
        if (!response.ok) throw new Error("Session unavailable");
        const value = (await response.json()) as WorkspaceAccount;
        if (!controller.signal.aborted)
          setRefreshed({ source: account, value });
      } catch {
        if (!controller.signal.aborted)
          setRefreshed({
            source: account,
            value: { ...account, permissions: [] },
          });
      }
    };
    void refresh();
    window.addEventListener("focus", refresh);
    return () => {
      controller.abort();
      window.removeEventListener("focus", refresh);
    };
  }, [account, pathname]);
  const current = refreshed?.source === account ? refreshed.value : account;
  return (
    <Access.Provider value={current}>
      {requiredPermission && !hasPermission(current, requiredPermission) ? (
        <NoAccess account={current} forbidden />
      ) : (
        children
      )}
    </Access.Provider>
  );
}
export function useWorkspaceAccount() {
  const account = useContext(Access);
  if (!account) throw new Error("Workspace account provider is required.");
  return account;
}
export function useCan() {
  const account = useWorkspaceAccount();
  return (permission: Permission) => hasPermission(account, permission);
}
