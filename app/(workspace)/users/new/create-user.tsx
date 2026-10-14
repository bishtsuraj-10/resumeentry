"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { passwordIssue } from "@/lib/workspace-access";
import { useCan } from "../../workspace-access";
import {
  Feedback,
  PageHeader,
  managementRequest,
  type ManagedRole,
  type ManagedUser,
} from "../management-ui";
export default function CreateUser() {
  const can = useCan();
  const router = useRouter();
  const [roles, setRoles] = useState<ManagedRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    managementRequest<{ items: ManagedRole[] }>("/api/roles", {
      signal: controller.signal,
    })
      .then((data) => {
        if (!controller.signal.aborted) setRoles(data.items);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !can("users.create")) return;
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
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const user = await managementRequest<ManagedUser>("/api/users", {
        method: "POST",
        body: JSON.stringify({
          name: String(data.get("name")).trim(),
          email: String(data.get("email")).trim().toLowerCase(),
          password,
          role: data.get("role"),
          isActive: data.get("isActive") === "on",
        }),
      });
      form.reset();
      setSuccess("User created successfully.");
      router.push(
        can("users.view")
          ? "/users/" + encodeURIComponent(user.id)
          : "/users/new",
      );
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create user.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="tool-page user-management">
      <PageHeader
        title="Add User"
        description="Create a workspace account with one role and optional additional permissions."
      >
        {can("users.view") && (
          <Link className="button button-secondary" href="/users">
            All Users
          </Link>
        )}
      </PageHeader>
      <Feedback error={error} success={success} />
      <section className="tool-panel">
        <h2>Account information</h2>
        <p className="management-muted">
          Access follows the assigned role. Additional grants can be configured
          in Permissions.
        </p>
        {loading && <p role="status">Loading available roles…</p>}
        <form className="management-form" onSubmit={submit}>
          <fieldset disabled={busy || loading || !roles.length}>
            <div className="management-form-grid">
              <label>
                Full Name
                <input
                  className="tool-input"
                  name="name"
                  required
                  maxLength={120}
                  autoComplete="name"
                />
              </label>
              <label>
                Email Address
                <input
                  className="tool-input"
                  name="email"
                  type="email"
                  required
                  maxLength={254}
                  autoComplete="email"
                />
              </label>
              <label>
                Initial Password
                <input
                  className="tool-input"
                  name="password"
                  type="password"
                  required
                  minLength={12}
                  maxLength={72}
                  autoComplete="new-password"
                  aria-describedby="password-policy"
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
              <label>
                Role
                <select
                  className="tool-input"
                  name="role"
                  required
                  defaultValue=""
                >
                  <option value="" disabled>
                    Select a role
                  </option>
                  {roles.map((role) => (
                    <option key={role.key} value={role.key}>
                      {role.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="management-check">
                <input name="isActive" type="checkbox" defaultChecked />
                Active account
              </label>
            </div>
            <p id="password-policy" className="management-muted">
              Use 12–72 characters, up to 72 UTF-8 bytes. Share the initial
              password privately with the account owner.
            </p>
            <div className="management-actions">
              <button
                className="button button-primary"
                disabled={busy || !can("users.create")}
              >
                {busy ? "Creating user…" : "Create User"}
              </button>
            </div>
          </fieldset>
        </form>
      </section>
    </main>
  );
}
