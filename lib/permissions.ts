export const PERMISSIONS = [
  "dashboard.view",
  "resumes.view",
  "resumes.edit",
  "resumes.download",
  "resumes.import",
  "resumes.export",
  "resumes.retry",
  "resumes.retry_all",
  "batches.view",
  "batches.manage",
  "settings.view",
  "users.view",
  "users.create",
  "users.update",
  "users.set_active",
  "users.reset_password",
  "roles.view",
  "roles.manage",
  "users.assign_role",
  "users.manage_grants",
] as const;
export type Permission = (typeof PERMISSIONS)[number];
export function isPermission(value: unknown): value is Permission {
  return (
    typeof value === "string" &&
    (PERMISSIONS as readonly string[]).includes(value)
  );
}
export function effectivePermissions(
  inherited: string[],
  additional: string[],
): Permission[] {
  return [...new Set([...inherited, ...additional])].filter(isPermission);
}
export function hasPermission(
  account: { role: string; permissions: readonly Permission[] },
  permission: Permission,
) {
  const administrative =
    permission.startsWith("users.") || permission.startsWith("roles.");
  return (
    (!administrative || account.role === "ADMIN") &&
    account.permissions.includes(permission)
  );
}
