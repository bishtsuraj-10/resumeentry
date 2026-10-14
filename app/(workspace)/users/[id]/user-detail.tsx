"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { passwordIssue } from "@/lib/workspace-access";
import { useCan, useWorkspaceAccount } from "../../workspace-access";
import {
  ActiveBadge,
  Feedback,
  PageHeader,
  managementRequest,
  type ManagedRole,
  type ManagedUser,
} from "../management-ui";
export default function UserDetail({ id }: { id: string }) {
  const can = useCan();
  const account = useWorkspaceAccount();
  const router = useRouter();
  const self = account.id === id;
  const [user, setUser] = useState<ManagedUser | null>(null);
  const [roles, setRoles] = useState<ManagedRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const showRoles = can("roles.view");
  useEffect(() => {
    const controller = new AbortController();
    managementRequest<ManagedUser>("/api/users/" + encodeURIComponent(id), {
      signal: controller.signal,
    })
      .then((data) => {
        if (!controller.signal.aborted) setUser(data);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    if (showRoles)
      managementRequest<{ items: ManagedRole[] }>("/api/roles", {
        signal: controller.signal,
      })
        .then((data) => {
          if (!controller.signal.aborted) setRoles(data.items);
        })
        .catch(() => {});
    return () => controller.abort();
  }, [id, showRoles]);
  async function change(
    action: string,
    method: string,
    data: object,
    message: string,
  ) {
    if (busy) return false;
    setBusy(action || "profile");
    setError("");
    setSuccess("");
    try {
      const updated = await managementRequest<ManagedUser>(
        "/api/users/" + encodeURIComponent(id) + (action ? "/" + action : ""),
        { method, body: JSON.stringify(data) },
      );
      setUser(updated);
      setSuccess(message);
      router.refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save account.");
      return false;
    } finally {
      setBusy("");
    }
  }
  async function profile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await change(
      "",
      "PATCH",
      {
        name: String(data.get("name")).trim(),
        email: String(data.get("email")).trim().toLowerCase(),
      },
      "Account details saved.",
    );
  }
  async function role(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (
      window.confirm(
        "Change this account's role? Individual additional grants will be preserved.",
      )
    )
      await change(
        "role",
        "PUT",
        { role: data.get("role") },
        "Role updated. Individual grants were preserved.",
      );
  }
  async function reset(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const password = String(data.get("password") ?? "");
    const issue = passwordIssue(
      password,
      String(data.get("confirmation") ?? ""),
    );
    if (issue) {
      setError(issue);
      return;
    }
    if (
      !window.confirm(
        "Reset this password and invalidate all existing sessions for this account?",
      )
    )
      return;
    if (
      await change(
        "password",
        "POST",
        { password },
        "Password reset. Existing sessions are invalidated.",
      )
    ) {
      form.reset();
      if (self) window.location.replace("/login");
    }
  }
  return (
    <main className="tool-page user-management">
      <PageHeader
        title={user?.name ?? "User account"}
        description="Account details and separately authorized access controls."
      >
        <Link className="button button-secondary" href="/users">
          All Users
        </Link>
      </PageHeader>
      <Feedback error={error} success={success} />
      {loading ? (
        <section className="tool-panel table-state" role="status">
          Loading account…
        </section>
      ) : (
        user && (
          <div className="management-stack">
            <section className="tool-panel">
              <div className="management-section-heading">
                <div>
                  <h2>Account details</h2>
                  <p className="management-muted">
                    Created {new Date(user.createdAt).toLocaleDateString()} ·{" "}
                    {roles.find((role) => role.key === user.role)?.name ??
                      user.role}
                  </p>
                </div>
                <ActiveBadge active={user.isActive} />
              </div>
              <form
                key={user.updatedAt + ":profile"}
                className="management-form"
                onSubmit={profile}
              >
                <fieldset disabled={!!busy || !can("users.update")}>
                  <div className="management-form-grid">
                    <label>
                      Full Name
                      <input
                        className="tool-input"
                        name="name"
                        defaultValue={user.name}
                        required
                        maxLength={120}
                      />
                    </label>
                    <label>
                      Email Address
                      <input
                        className="tool-input"
                        name="email"
                        type="email"
                        defaultValue={user.email}
                        required
                        maxLength={254}
                      />
                    </label>
                  </div>
                  {can("users.update") && (
                    <button className="button button-primary">
                      {busy === "profile" ? "Saving…" : "Save details"}
                    </button>
                  )}
                </fieldset>
              </form>
            </section>
            <section className="tool-panel">
              <h2>Role and account status</h2>
              <p className="management-muted">
                Inherited access updates after a role change. Individual grants
                are retained. The final active Administrator is protected by the
                server.
              </p>
              {self && (
                <p className="management-note">
                  You cannot change your own role, active status or additional
                  grants.
                </p>
              )}
              {!self && can("users.assign_role") && (
                <form
                  key={user.updatedAt + ":role"}
                  className="management-form"
                  onSubmit={role}
                >
                  <fieldset disabled={!!busy || !roles.length}>
                    <label>
                      Assigned role
                      <select
                        className="tool-input"
                        name="role"
                        defaultValue={user.role}
                        required
                      >
                        {roles.map((role) => (
                          <option value={role.key} key={role.key}>
                            {role.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button className="button button-secondary">
                      Change role
                    </button>
                  </fieldset>
                </form>
              )}
              <div className="management-actions">
                {!self && can("users.set_active") && (
                  <button
                    className={
                      "button " +
                      (user.isActive ? "management-danger" : "button-secondary")
                    }
                    disabled={!!busy}
                    onClick={async () => {
                      if (
                        window.confirm(
                          user.isActive
                            ? "Deactivate this account? Access and existing sessions will be revoked. The final active Administrator cannot be disabled."
                            : "Activate this account?",
                        )
                      )
                        await change(
                          "status",
                          "PATCH",
                          { isActive: !user.isActive },
                          user.isActive
                            ? "Account deactivated."
                            : "Account activated.",
                        );
                    }}
                  >
                    {user.isActive ? "Deactivate account" : "Activate account"}
                  </button>
                )}
                {can("roles.view") && (
                  <Link className="button button-secondary" href="/permissions">
                    Manage permissions
                  </Link>
                )}
              </div>
            </section>
            {can("users.reset_password") && (
              <section className="tool-panel">
                <h2>Reset password</h2>
                <p className="management-muted">
                  Use 12–72 characters and no more than 72 UTF-8 bytes.
                  Resetting invalidates all current sessions.
                </p>
                <form className="management-form" onSubmit={reset}>
                  <fieldset disabled={!!busy}>
                    <div className="management-form-grid">
                      <label>
                        New Password
                        <input
                          className="tool-input"
                          name="password"
                          type="password"
                          required
                          minLength={12}
                          maxLength={72}
                          autoComplete="new-password"
                        />
                      </label>
                      <label>
                        Confirm Password
                        <input
                          className="tool-input"
                          name="confirmation"
                          type="password"
                          required
                          minLength={12}
                          maxLength={72}
                          autoComplete="new-password"
                        />
                      </label>
                    </div>
                    <button className="button button-secondary">
                      {busy === "password" ? "Resetting…" : "Reset password"}
                    </button>
                  </fieldset>
                </form>
              </section>
            )}
          </div>
        )
      )}
    </main>
  );
}
