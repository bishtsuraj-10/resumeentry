"use client";
import { useEffect, useState } from "react";
import type { Permission } from "@/lib/permissions";
import type { EditorState } from "./role-editor";
import { useCan, useWorkspaceAccount } from "../workspace-access";
import {
  Feedback,
  managementRequest,
  type ManagedUser,
} from "../users/management-ui";
import PermissionPicker, { samePermissions } from "./permission-picker";
type Grants = {
  userId: string;
  role: string;
  inherited: string[];
  additional: string[];
  effective: string[];
};
export default function UserGrants({
  user,
  catalog,
  onStateChange,
  back,
}: {
  user: ManagedUser;
  catalog: Permission[];
  onStateChange?: (state: EditorState) => void;
  back?: () => void;
}) {
  const account = useWorkspaceAccount();
  const can = useCan();
  const editable = account.id !== user.id && can("users.manage_grants");
  const [grants, setGrants] = useState<Grants | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    managementRequest<Grants>(
      "/api/users/" + encodeURIComponent(user.id) + "/grants",
      { signal: controller.signal },
    )
      .then((data) => {
        if (!controller.signal.aborted) {
          setGrants(data);
          setSelected(data.additional);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [user.id]);
  const dirty =
    editable && !!grants && !samePermissions(selected, grants.additional);
  useEffect(() => {
    onStateChange?.({ dirty, busy });
  }, [dirty, busy, onStateChange]);
  async function save() {
    if (!editable || !grants || busy) return;
    const added = selected.filter((p) => !grants.additional.includes(p));
    const removed = grants.additional.filter((p) => !selected.includes(p));
    if (!added.length && !removed.length) {
      setSuccess("No additional grant changes to save.");
      return;
    }
    if (
      !window.confirm(
        "Save additional permission changes for " +
          user.name +
          "? Inherited role permissions will remain unchanged.",
      )
    )
      return;
    setBusy(true);
    setError("");
    setSuccess("");
    const url = "/api/users/" + encodeURIComponent(user.id) + "/grants";
    try {
      if (added.length)
        await managementRequest(url, {
          method: "POST",
          body: JSON.stringify({ permissions: added }),
        });
      if (removed.length)
        await managementRequest(url, {
          method: "DELETE",
          body: JSON.stringify({ permissions: removed }),
        });
      const updated = await managementRequest<Grants>(url);
      setGrants(updated);
      setSelected(updated.additional);
      setSuccess("Additional grants saved. Role permissions are unchanged.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save grants.");
      try {
        const current = await managementRequest<Grants>(url);
        setGrants(current);
        setSelected(current.additional);
      } catch {}
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="tool-panel permissions-editor"
      aria-label="Selected user permissions"
    >
      <div className="permissions-editor-heading">
        {back && (
          <button
            type="button"
            className="button button-secondary"
            disabled={busy}
            onClick={back}
          >
            ← Choose another user
          </button>
        )}
        <h2>{user.name}</h2>
        <p className="management-muted">
          {user.email} · Assigned role: {grants?.role ?? user.role}
        </p>
      </div>
      <div className="permissions-editor-scroll">
        <Feedback error={error} success={success} />
        {!grants ? (
          !error && <p role="status">Loading user permissions…</p>
        ) : (
          <>
            <div className="permission-summary">
              {[
                ["Inherited from role", grants.inherited],
                ["Individual additional grants", grants.additional],
                ["Effective permissions", grants.effective],
              ].map(([label, values]) => (
                <details key={label as string}>
                  <summary>
                    {label as string}
                    <span className="count-badge">
                      {(values as string[]).length}
                    </span>
                  </summary>
                  {(values as string[]).length ? (
                    <ul>
                      {(values as string[]).map((p) => (
                        <li key={p}>
                          <code>{p}</code>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="management-muted">None</p>
                  )}
                </details>
              ))}
            </div>
            <p className="management-note">
              Effective permissions combine the role and individual grants.
              Revoking a grant preserves any access inherited from the role.
              Administrative actions also require the Administrator role.
            </p>
            {account.id === user.id && (
              <p className="management-note">
                You cannot change your own additional permissions.
              </p>
            )}
            <h3>Configure additional grants</h3>
            <PermissionPicker
              catalog={catalog}
              selected={selected}
              onChange={setSelected}
              disabled={!editable || busy}
              label="Individual additional grants"
            />
          </>
        )}
      </div>
      {grants && (
        <div className="permissions-action-bar">
          <span className="management-muted" role="status">
            {busy
              ? "Saving…"
              : dirty
                ? "Unsaved changes"
                : "No unsaved changes"}
          </span>
          {editable && (
            <div className="management-actions">
              <button
                className="button button-primary"
                disabled={busy || !dirty}
                onClick={save}
              >
                {busy ? "Saving…" : "Save additional grants"}
              </button>
              <button
                type="button"
                className="button button-secondary"
                disabled={busy || !dirty}
                onClick={() => {
                  setSelected(grants.additional);
                  setError("");
                  setSuccess("");
                }}
              >
                Revert
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
