"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import SignOutButton from "./sign-out-button";

import type { WorkspaceAccount } from "@/lib/workspace-access";
import { useCan } from "./workspace-access";

export default function AccountMenu({
  account,
}: {
  account: WorkspaceAccount;
}) {
  const can = useCan();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  function close(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }
  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  return (
    <div
      ref={containerRef}
      className="account-menu"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close(true);
        }
        if (
          open &&
          ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
        ) {
          event.preventDefault();
          const items = Array.from(
            menuRef.current?.querySelectorAll<HTMLElement>(
              '[role="menuitem"]:not(:disabled)',
            ) ?? [],
          );
          const index = items.indexOf(document.activeElement as HTMLElement);
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? items.length - 1
                : (index + (event.key === "ArrowUp" ? -1 : 1) + items.length) %
                  items.length;
          items[next]?.focus();
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="top-avatar account-trigger"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="workspace-account-menu"
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {account.email.slice(0, 2).toUpperCase()}
      </button>
      {open && (
        <div
          ref={menuRef}
          id="workspace-account-menu"
          className="account-dropdown"
          role="menu"
          aria-label="Account actions"
        >
          <div className="account-details" role="presentation">
            <span className="account-section-label">Signed in as</span>
            <strong>{account.email}</strong>
            <span className="account-role">{account.role}</span>
          </div>
          {can("settings.view") && (
            <Link
              href="/settings"
              role="menuitem"
              className="account-menu-item"
              onClick={() => close()}
            >
              Settings
            </Link>
          )}
          <SignOutButton
            className="account-menu-item sign-out-menu-item"
            menuItem
          />
        </div>
      )}
    </div>
  );
}
