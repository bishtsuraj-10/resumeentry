"use client";
import { useEffect, useRef, useState } from "react";
import type { Permission } from "@/lib/permissions";
import { useCan } from "../workspace-access";
import {
  Feedback,
  managementRequest,
  type ManagedRole,
} from "../users/management-ui";
import PermissionPicker, { samePermissions } from "./permission-picker";
export type EditorState = { dirty: boolean; busy: boolean };
export default function RoleEditor({
  role,
  catalog,
  reload,
  deleted,
  onStateChange,
  back,
}: {
  role: ManagedRole;
  catalog: Permission[];
  reload: () => Promise<void>;
  deleted: () => void;
  onStateChange?: (state: EditorState) => void;
  back?: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (window.matchMedia("(max-width: 800px)").matches)
      heading.current?.focus({ preventScroll: true });
  }, []);
  const can = useCan();
  const protectedRole = role.isSystem || role.key === "ADMIN";
  const editable = can("roles.manage") && !protectedRole;
  const [name, setName] = useState(role.name);
  const [selected, setSelected] = useState(
    role.permissions.map((p) => p.permission),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const dirty =
    editable &&
    (name.trim() !== role.name ||
      !samePermissions(
        selected,
        role.permissions.map((p) => p.permission),
      ));
  useEffect(() => {
    onStateChange?.({ dirty, busy });
  }, [dirty, busy, onStateChange]);
  function revert() {
    setName(role.name);
    setSelected(role.permissions.map((p) => p.permission));
    setError("");
    setSuccess("");
  }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !editable ||
      !dirty ||
      busy ||
      !window.confirm(
        "Save this role's name and permissions? This affects every account assigned to it.",
      )
    )
      return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const url = "/api/roles/" + encodeURIComponent(role.key);
      if (name.trim() !== role.name)
        await managementRequest(url, {
          method: "PATCH",
          body: JSON.stringify({ name: name.trim() }),
        });
      await managementRequest(url + "/permissions", {
        method: "PUT",
        body: JSON.stringify({ permissions: selected }),
      });
      setSuccess(
        "Role permissions saved. Inherited access updates on subsequent requests.",
      );
      await reload();
    } catch (e) {
      setError(
        (e instanceof Error ? e.message : "Could not save role.") +
          " Name and permissions save separately; reload before retrying to check current values.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (
      !editable ||
      busy ||
      role._count.users > 0 ||
      !window.confirm("Delete this unused role? This cannot be undone.")
    )
      return;
    setBusy(true);
    setError("");
    try {
      await managementRequest("/api/roles/" + encodeURIComponent(role.key), {
        method: "DELETE",
      });
      deleted();
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete role.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="tool-panel permissions-editor"
      aria-label="Selected role editor"
    >
      <div className="permissions-editor-heading">
        {back && (
          <button
            type="button"
            className="button button-secondary permissions-mobile-back"
            onClick={back}
            disabled={busy}
          >
            ← Back to roles
          </button>
        )}
        <div className="management-section-heading">
          <div>
            <h2 ref={heading} tabIndex={-1}>
              {role.name}
            </h2>
            <p className="management-muted">
              {role.key} · {role._count.users} assigned accounts
            </p>
          </div>
          {protectedRole && (
            <span className="count-badge">Protected system role</span>
          )}
        </div>
      </div>
      <form className="management-form permissions-editor-form" onSubmit={save}>
        <div className="permissions-editor-scroll">
          <Feedback error={error} success={success} />
          {protectedRole && (
            <p className="management-note">
              System Administrator permissions and name are protected.
            </p>
          )}
          <label>
            Role name
            <input
              className="tool-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={120}
              disabled={!editable || busy}
            />
          </label>
          <PermissionPicker
            catalog={catalog}
            selected={selected}
            onChange={setSelected}
            disabled={!editable || busy}
            label="Role permissions"
          />
        </div>
        <div className="permissions-action-bar">
          <span className="management-muted" role="status">
            {busy
              ? "Saving…"
              : dirty
                ? "Unsaved changes"
                : protectedRole
                  ? "Read-only system role"
                  : "No unsaved changes"}
          </span>
          {editable && (
            <div className="management-actions">
              <button
                className="button button-primary"
                disabled={busy || !dirty}
              >
                {busy ? "Saving…" : "Save Changes"}
              </button>
              <button
                type="button"
                className="button button-secondary"
                disabled={busy || !dirty}
                onClick={revert}
              >
                Revert
              </button>
              <button
                type="button"
                className="button management-danger"
                disabled={busy || role._count.users > 0}
                onClick={remove}
                title={
                  role._count.users > 0
                    ? "Reassign every account before deleting this role."
                    : undefined
                }
              >
                Delete Role
              </button>
            </div>
          )}
        </div>
      </form>
    </section>
  );
}
