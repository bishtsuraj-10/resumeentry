"use client";
import { useState } from "react";
import type { Permission } from "@/lib/permissions";
export function permissionGroups(catalog: readonly Permission[]) {
  const labels: Record<string, string> = {
    dashboard: "Dashboard",
    resumes: "Resumes",
    batches: "Processing",
    settings: "Settings",
    users: "User Management",
    roles: "Role Management",
    export: "Export",
  };
  const groups: Record<string, Permission[]> = {};
  for (const permission of catalog) {
    const domain =
      permission === "resumes.export" ? "export" : permission.split(".")[0];
    const label = labels[domain] ?? domain;
    (groups[label] ??= []).push(permission);
  }
  return Object.entries(groups);
}
export function samePermissions(
  first: readonly string[],
  second: readonly string[],
) {
  return (
    first.length === second.length &&
    first.every((permission) => second.includes(permission))
  );
}
export default function PermissionPicker({
  catalog,
  selected,
  onChange,
  disabled,
  label,
}: {
  catalog: Permission[];
  selected: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
  label: string;
}) {
  const groups = permissionGroups(catalog);
  const [expanded, setExpanded] = useState<string[]>(() =>
    groups.slice(0, 2).map(([name]) => name),
  );
  return (
    <div className="permission-groups" role="group" aria-label={label}>
      {groups.map(([group, permissions]) => {
        const count = permissions.filter((permission) =>
          selected.includes(permission),
        ).length;
        const open = expanded.includes(group);
        return (
          <section className="permission-category" key={group}>
            <button
              type="button"
              className="permission-category-toggle"
              aria-expanded={open}
              onClick={() =>
                setExpanded(
                  open
                    ? expanded.filter((name) => name !== group)
                    : [...expanded, group],
                )
              }
            >
              <span>{group}</span>
              <span className="permission-category-count">
                {count} / {permissions.length} selected{" "}
                <span aria-hidden="true">{open ? "−" : "+"}</span>
              </span>
            </button>
            {open && (
              <fieldset disabled={disabled} aria-label={group}>
                <legend className="sr-only">{group}</legend>
                {!disabled && (
                  <label className="management-check permission-select-all">
                    <input
                      type="checkbox"
                      aria-label={"Select all " + group}
                      checked={count === permissions.length}
                      ref={(input) => {
                        if (input)
                          input.indeterminate =
                            count > 0 && count < permissions.length;
                      }}
                      onChange={(event) =>
                        onChange(
                          event.target.checked
                            ? [...new Set([...selected, ...permissions])]
                            : selected.filter(
                                (permission) =>
                                  !permissions.includes(
                                    permission as Permission,
                                  ),
                              ),
                        )
                      }
                    />
                    <span>Select all in {group}</span>
                  </label>
                )}
                {permissions.map((permission) => (
                  <label className="management-check" key={permission}>
                    <input
                      type="checkbox"
                      checked={selected.includes(permission)}
                      onChange={(event) =>
                        onChange(
                          event.target.checked
                            ? [...new Set([...selected, permission])]
                            : selected.filter((item) => item !== permission),
                        )
                      }
                    />
                    <span>
                      {permission.split(".")[1].replaceAll("_", " ")}
                      <small>{permission}</small>
                    </span>
                  </label>
                ))}
              </fieldset>
            )}
          </section>
        );
      })}
    </div>
  );
}
