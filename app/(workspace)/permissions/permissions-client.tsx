"use client";
import { useEffect, useRef, useState } from "react";
import type { Permission } from "@/lib/permissions";
import { useCan } from "../workspace-access";
import {
  Feedback,
  PageHeader,
  managementRequest,
  type ManagedRole,
  type ManagedUser,
} from "../users/management-ui";
import UserList from "../users/user-list";
import RoleEditor, { type EditorState } from "./role-editor";
import UserGrants from "./user-grants";
import CreateRoleDialog from "./create-role-dialog";
type Tab = "roles" | "users";
export default function Permissions() {
  const can = useCan();
  const [tab, setTab] = useState<Tab>("roles");
  const tabs = useRef<HTMLDivElement>(null);
  const [roles, setRoles] = useState<ManagedRole[]>([]);
  const [catalog, setCatalog] = useState<Permission[]>([]);
  const [selectedRole, setSelectedRole] = useState("");
  const [selectedUser, setSelectedUser] = useState<ManagedUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [editorState, setEditorState] = useState<EditorState>({
    dirty: false,
    busy: false,
  });
  const [editorEpoch, setEditorEpoch] = useState(0);
  async function reload() {
    const data = await managementRequest<{ items: ManagedRole[] }>(
      "/api/roles",
    );
    setRoles(data.items);
  }
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      managementRequest<{ items: ManagedRole[] }>("/api/roles", {
        signal: controller.signal,
      }),
      managementRequest<{ permissions: Permission[] }>("/api/permissions", {
        signal: controller.signal,
      }),
    ])
      .then(([data, definitions]) => {
        if (!controller.signal.aborted) {
          setRoles(data.items);
          setCatalog(definitions.permissions);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!editorState.dirty) return;
    const prevent = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [editorState.dirty]);
  function allowLeave() {
    return (
      !editorState.busy &&
      (!editorState.dirty ||
        window.confirm("Discard unsaved permission changes?"))
    );
  }
  function chooseRole(key: string) {
    if (key === selectedRole || !allowLeave()) return false;
    setSelectedRole(key);
    setEditorState({ dirty: false, busy: false });
    return true;
  }
  function chooseTab(next: Tab) {
    if (next === tab || !allowLeave()) return;
    setTab(next);
    setEditorState({ dirty: false, busy: false });
  }
  function backToUsers() {
    if (!allowLeave()) return;
    setSelectedUser(null);
    setEditorState({ dirty: false, busy: false });
  }
  function openCreate() {
    if (!allowLeave()) return;
    if (editorState.dirty) setEditorEpoch((value) => value + 1);
    setEditorState({ dirty: false, busy: false });
    setCreating(true);
  }
  const role = roles.find((item) => item.key === selectedRole);
  const filteredRoles = roles.filter((item) =>
    (item.name + " " + item.key).toLowerCase().includes(search.toLowerCase()),
  );
  function tabKey(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (
      !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) ||
      !can("users.view")
    )
      return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? "roles"
        : event.key === "End"
          ? "users"
          : tab === "roles"
            ? "users"
            : "roles";
    if (next !== tab && !allowLeave()) return;
    setTab(next);
    setEditorState({ dirty: false, busy: false });
    tabs.current
      ?.querySelector<HTMLButtonElement>("#permissions-tab-" + next)
      ?.focus();
  }
  return (
    <main className="tool-page user-management permissions-page">
      <PageHeader
        title="Permissions"
        description="Manage role access and additional grants for individual users."
      >
        {can("roles.manage") && (
          <button
            type="button"
            className="button button-primary"
            disabled={loading || editorState.busy}
            onClick={openCreate}
          >
            ＋ Create Role
          </button>
        )}
      </PageHeader>
      <Feedback error={error} success={success} />
      <div
        className="management-tabs permissions-tabs"
        role="tablist"
        aria-label="Permission sections"
        ref={tabs}
      >
        {(["roles", ...(can("users.view") ? ["users"] : [])] as Tab[]).map(
          (item) => (
            <button
              type="button"
              key={item}
              id={"permissions-tab-" + item}
              role="tab"
              aria-selected={tab === item}
              aria-controls={"permissions-panel-" + item}
              tabIndex={tab === item ? 0 : -1}
              className={
                "button " +
                (tab === item ? "button-primary" : "button-secondary")
              }
              onKeyDown={tabKey}
              onClick={() => chooseTab(item)}
            >
              {item === "roles" ? "Role Permissions" : "User Permissions"}
            </button>
          ),
        )}
      </div>
      <section
        role="tabpanel"
        id={"permissions-panel-" + tab}
        aria-labelledby={"permissions-tab-" + tab}
        tabIndex={0}
      >
        {loading ? (
          <section className="tool-panel table-state" role="status">
            Loading roles and permission catalog…
          </section>
        ) : error && !catalog.length ? (
          <section className="tool-panel">
            <button
              className="button button-secondary"
              onClick={() => window.location.reload()}
            >
              Reload permissions
            </button>
          </section>
        ) : tab === "roles" ? (
          <div className="permissions-master-detail" data-detail={!!role}>
            <aside
              className="panel permissions-role-list"
              aria-label="Existing roles"
            >
              <div className="permissions-list-heading">
                <h2>
                  Existing roles{" "}
                  <span className="count-badge">{roles.length}</span>
                </h2>
                <label className="search-box">
                  <span aria-hidden="true">⌕</span>
                  <input
                    type="search"
                    aria-label="Search roles"
                    placeholder="Search roles…"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </label>
              </div>
              <div className="permissions-role-scroll">
                {filteredRoles.map((item) => (
                  <button
                    type="button"
                    key={item.key}
                    className="permissions-role-option"
                    aria-pressed={selectedRole === item.key}
                    disabled={editorState.busy}
                    onClick={() => chooseRole(item.key)}
                  >
                    <span className="permissions-role-title">
                      {item.name}
                      {(item.isSystem || item.key === "ADMIN") && (
                        <span className="count-badge">Protected</span>
                      )}
                    </span>
                    <span className="management-subtext">{item.key}</span>
                    <span className="permissions-role-meta">
                      {item._count.users} accounts · {item.permissions.length}{" "}
                      permissions
                    </span>
                  </button>
                ))}
                {!filteredRoles.length && (
                  <p className="permissions-list-empty">
                    {search ? "No matching roles." : "No roles are available."}
                  </p>
                )}
              </div>
            </aside>
            {role ? (
              <RoleEditor
                key={role.key + ":" + editorEpoch}
                role={role}
                catalog={catalog}
                reload={reload}
                deleted={() => {
                  setSelectedRole("");
                  setEditorState({ dirty: false, busy: false });
                  setSuccess("Unused role deleted.");
                }}
                onStateChange={setEditorState}
                back={() => {
                  if (chooseRole(""))
                    requestAnimationFrame(() =>
                      document
                        .querySelector<HTMLInputElement>(
                          'input[aria-label="Search roles"]',
                        )
                        ?.focus(),
                    );
                }}
              />
            ) : (
              <section className="tool-panel permissions-empty">
                <span className="permissions-empty-icon" aria-hidden="true">
                  ◇
                </span>
                <h2>Select a role</h2>
                <p>Choose a role to inspect or configure its permissions.</p>
              </section>
            )}
          </div>
        ) : (
          can("users.view") && (
            <div className="permissions-user-stage">
              {selectedUser ? (
                <UserGrants
                  key={selectedUser.id + ":" + editorEpoch}
                  user={selectedUser}
                  catalog={catalog}
                  onStateChange={setEditorState}
                  back={backToUsers}
                />
              ) : (
                <>
                  <p className="management-muted">
                    Step 1 of 2 · Search and select an account to manage
                    individual access.
                  </p>
                  <UserList
                    onSelect={(user) => {
                      setSelectedUser(user);
                      setEditorState({ dirty: false, busy: false });
                    }}
                  />
                </>
              )}
            </div>
          )
        )}
      </section>
      {creating && (
        <CreateRoleDialog
          close={() => setCreating(false)}
          created={async (key) => {
            await reload();
            setSearch("");
            setSelectedRole(key);
            setSelectedUser(null);
            setTab("roles");
            setCreating(false);
            setEditorState({ dirty: false, busy: false });
            setSuccess(
              "Role created. Select its permissions and save to grant access.",
            );
          }}
        />
      )}
    </main>
  );
}
