import { hasPermission, type Permission } from "./permissions";
export type WorkspaceAccount = {
  id: string;
  name: string;
  email: string;
  role: string;
  permissions: Permission[];
};
export const navigation = [
  {
    label: "Workspace",
    items: [
      { label: "Overview", icon: "⌂", href: "/", permission: "dashboard.view" },
      {
        label: "All resumes",
        icon: "▤",
        href: "/resumes",
        permission: "resumes.view",
      },
      {
        label: "Review queue",
        icon: "◷",
        href: "/review",
        permission: "resumes.view",
      },
      {
        label: "Duplicates",
        icon: "⧉",
        href: "/duplicates",
        permission: "resumes.view",
      },
      {
        label: "Failed resumes",
        icon: "!",
        href: "/failed",
        permission: "resumes.view",
      },
    ],
  },
  {
    label: "Users",
    items: [
      {
        label: "Add User",
        icon: "+",
        href: "/users/new",
        permission: "users.create",
      },
      {
        label: "All Users",
        icon: "♙",
        href: "/users",
        permission: "users.view",
      },
      {
        label: "Permissions",
        icon: "◇",
        href: "/permissions",
        permission: "roles.view",
      },
    ],
  },
  {
    label: "Manage",
    items: [
      {
        label: "Import files",
        icon: "↑",
        href: "/import",
        permission: "resumes.import",
      },
      {
        label: "Processing",
        icon: "◉",
        href: "/batches",
        permission: "batches.view",
      },
      {
        label: "Export data",
        icon: "⇩",
        href: "/export",
        permission: "resumes.export",
      },
    ],
  },
] satisfies {
  label: string;
  items: {
    label: string;
    icon: string;
    href: string;
    permission: Permission;
  }[];
}[];
export function visibleNavigation(account: WorkspaceAccount) {
  return navigation
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        hasPermission(account, item.permission),
      ),
    }))
    .filter((group) => group.items.length);
}
export function isActiveRoute(pathname: string, href: string) {
  if (href === "/users")
    return (
      pathname === href ||
      (pathname.startsWith("/users/") && pathname !== "/users/new")
    );
  return pathname === href || (href !== "/" && pathname.startsWith(href + "/"));
}
export function firstDestination(account: WorkspaceAccount) {
  const item = visibleNavigation(account).flatMap((group) => group.items)[0];
  return (
    item?.href ??
    (hasPermission(account, "settings.view") ? "/settings" : "/no-access")
  );
}
export function passwordIssue(password: string, confirmation: string) {
  if (
    password.length < 12 ||
    password.length > 72 ||
    new TextEncoder().encode(password).length > 72
  )
    return "Use 12–72 characters, with no more than 72 UTF-8 bytes.";
  if (password !== confirmation) return "Passwords do not match.";
  return "";
}
