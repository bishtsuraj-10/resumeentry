"use client";
import { useEffect, useRef, useState } from "react";
import {
  Feedback,
  managementRequest,
  type ManagedRole,
} from "../users/management-ui";
export default function CreateRoleDialog({
  close,
  created,
}: {
  close: () => void;
  created: (key: string) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
      previouslyFocused?.focus();
    };
  }, []);
  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const role = await managementRequest<ManagedRole>("/api/roles", {
        method: "POST",
        body: JSON.stringify({
          key: String(data.get("key")).trim(),
          name: String(data.get("name")).trim(),
        }),
      });
      await created(role.key);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create role.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      className="permissions-create-dialog"
      ref={dialog}
      aria-labelledby="create-role-title"
      aria-describedby="create-role-description"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) close();
      }}
    >
      <div className="permissions-dialog-heading">
        <div>
          <h2 id="create-role-title">Create Role</h2>
          <p id="create-role-description" className="management-muted">
            Create a role, then choose its permissions.
          </p>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Close create role"
          disabled={busy}
          onClick={close}
        >
          ×
        </button>
      </div>
      <Feedback error={error} />
      <form className="management-form" onSubmit={create}>
        <fieldset disabled={busy}>
          <label>
            Role name
            <input
              className="tool-input"
              name="name"
              required
              maxLength={120}
              placeholder="e.g. Recruiter"
            />
          </label>
          <label>
            Role key
            <input
              className="tool-input"
              name="key"
              required
              pattern="[A-Z][A-Z0-9_]{0,63}"
              maxLength={64}
              placeholder="e.g. RECRUITER"
              aria-describedby="role-key-help"
            />
          </label>
          <p id="role-key-help" className="management-muted">
            Use an uppercase key with letters, numbers or underscores. The key
            remains fixed after creation.
          </p>
          <div className="management-actions">
            <button className="button button-primary">
              {busy ? "Creating…" : "Create role"}
            </button>
            <button
              type="button"
              className="button button-secondary"
              onClick={close}
            >
              Cancel
            </button>
          </div>
        </fieldset>
      </form>
    </dialog>
  );
}
