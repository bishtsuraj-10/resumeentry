"use client";
import Link from "next/link";
export type ManagedUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};
export type ManagedRole = {
  key: string;
  name: string;
  isSystem: boolean;
  permissions: { permission: string }[];
  _count: { users: number };
};
export type UserPage = {
  items: ManagedUser[];
  total: number;
  page: number;
  pages: number;
};
export async function managementRequest<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401) window.location.replace("/login");
    throw new Error(
      data?.error ?? "The request could not be completed. Try again.",
    );
  }
  return data as T;
}
export function PageHeader({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="tool-header">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children && <div className="management-actions">{children}</div>}
    </header>
  );
}
export function Feedback({
  error,
  success,
}: {
  error?: string;
  success?: string;
}) {
  return (
    <>
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className="management-success" role="status">
          {success}
        </p>
      )}
    </>
  );
}
export function ActiveBadge({ active }: { active: boolean }) {
  return (
    <span
      className={
        "status-pill " + (active ? "status-completed" : "status-cancelled")
      }
    >
      <i aria-hidden="true" />
      {active ? "Active" : "Inactive"}
    </span>
  );
}
export function UserLink({ user }: { user: ManagedUser }) {
  return (
    <Link
      className="candidate-cell"
      href={"/users/" + encodeURIComponent(user.id)}
    >
      <span className="candidate-avatar tone-violet" aria-hidden="true">
        {user.name.slice(0, 2).toUpperCase()}
      </span>
      <div>
        <b>{user.name}</b>
        <span>{user.email}</span>
      </div>
    </Link>
  );
}
