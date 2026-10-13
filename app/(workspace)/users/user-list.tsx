"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useCan } from "../workspace-access";
import {
  ActiveBadge,
  UserLink,
  managementRequest,
  type ManagedRole,
  type ManagedUser,
  type UserPage,
} from "./management-ui";
export default function UserList({
  onSelect,
}: {
  onSelect?: (user: ManagedUser) => void;
}) {
  const can = useCan();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<UserPage | null>(null);
  const [roles, setRoles] = useState<ManagedRole[]>([]);
  const [error, setError] = useState("");
  const [loadedKey, setLoadedKey] = useState("");
  const requestKey = JSON.stringify([search, page]);
  const loading = loadedKey !== requestKey;
  const showRoles = can("roles.view");
  useEffect(() => {
    if (!showRoles) return;
    const controller = new AbortController();
    managementRequest<{ items: ManagedRole[] }>("/api/roles", {
      signal: controller.signal,
    })
      .then((data) => {
        if (!controller.signal.aborted) setRoles(data.items);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [showRoles]);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      const query = new URLSearchParams({
        search,
        page: String(page),
        limit: "25",
      });
      managementRequest<UserPage>("/api/users?" + query, {
        signal: controller.signal,
      })
        .then((data) => {
          if (!controller.signal.aborted) {
            setResult(data);
            setError("");
            setLoadedKey(requestKey);
          }
        })
        .catch((e) => {
          if (!controller.signal.aborted) {
            setResult(null);
            setError(e.message);
            setLoadedKey(requestKey);
          }
        });
    }, 200);
    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [search, page, requestKey]);
  return (
    <section className="panel table-panel">
      <div className="table-heading">
        <div>
          <h2>{onSelect ? "Select a user" : "Workspace users"}</h2>
          <p>
            {onSelect
              ? "Search accounts to inspect inherited and additional permissions."
              : "Manage account details, role assignments, status and passwords."}
          </p>
        </div>
      </div>
      <div className="table-toolbar">
        <label className="search-box">
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            aria-label="Search users"
            placeholder="Search name or email…"
            maxLength={150}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </label>
        <span className="management-muted">
          {!loading && !error && result ? result.total + " users" : ""}
        </span>
      </div>
      <div
        className="table-scroll"
        tabIndex={0}
        role="region"
        aria-label="Users table"
        aria-busy={loading}
      >
        <table>
          <thead>
            <tr>
              <th>USER</th>
              <th>EMAIL</th>
              <th>ROLE</th>
              <th>STATUS</th>
              <th>CREATED</th>
              <th>ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {!loading &&
              !error &&
              result?.items.map((user) => (
                <tr key={user.id}>
                  <td>
                    {onSelect ? <b>{user.name}</b> : <UserLink user={user} />}
                  </td>
                  <td>{user.email}</td>
                  <td>
                    {roles.find((role) => role.key === user.role)?.name ??
                      user.role}
                  </td>
                  <td>
                    <ActiveBadge active={user.isActive} />
                  </td>
                  <td>{new Date(user.createdAt).toLocaleDateString()}</td>
                  <td>
                    {onSelect ? (
                      <button
                        className="button button-secondary"
                        onClick={() => onSelect(user)}
                      >
                        Select
                      </button>
                    ) : (
                      <Link
                        className="button button-secondary"
                        href={"/users/" + encodeURIComponent(user.id)}
                      >
                        View / Manage
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {loading ? (
        <div className="table-state" role="status">
          Loading users…
        </div>
      ) : error ? (
        <div className="table-state ui-error" role="alert">
          {error}
          <button
            className="button button-secondary"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
      ) : !result?.items.length ? (
        <div className="empty-search">
          <strong>No users found</strong>
          <p>
            {search
              ? "Try another name or email."
              : "Create a user to get started."}
          </p>
        </div>
      ) : null}
      <div className="table-footer">
        <span>
          {!loading && !error && result
            ? "Page " + page + " of " + Math.max(1, result.pages)
            : ""}
        </span>
        <div className="pagination">
          <button
            aria-label="Previous users page"
            disabled={loading || !!error || page <= 1}
            onClick={() => setPage(page - 1)}
          >
            ←
          </button>
          <button
            aria-label="Next users page"
            disabled={loading || !!error || !result || page >= result.pages}
            onClick={() => setPage(page + 1)}
          >
            →
          </button>
        </div>
      </div>
    </section>
  );
}
