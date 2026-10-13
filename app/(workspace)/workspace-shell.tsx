"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import ThemeToggle from "../theme-toggle";
import AccountMenu from "./account-menu";
import { useWorkspaceAccount, useCan } from "./workspace-access";
import {
  firstDestination,
  isActiveRoute,
  visibleNavigation,
} from "@/lib/workspace-access";

function Icon({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center justify-center ${className}`}
      aria-hidden="true"
    >
      {children}
    </span>
  );
}

const sidebarPreferenceKey = "talentflow.sidebar.collapsed";
let fallbackCollapsed = false;
let storageUnavailable = false;
function readCollapsed() {
  if (storageUnavailable) return fallbackCollapsed;
  try {
    return window.localStorage.getItem(sidebarPreferenceKey) === "true";
  } catch {
    return fallbackCollapsed;
  }
}
function subscribePreference(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener("talentflow-sidebar-change", listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener("talentflow-sidebar-change", listener);
  };
}
function subscribeMobile(listener: () => void) {
  const media = window.matchMedia("(max-width: 900px)");
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}
const readMobile = () => window.matchMedia("(max-width: 900px)").matches;
const serverSnapshot = () => false;

export default function WorkspaceShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const account = useWorkspaceAccount();
  const can = useCan();
  const nav = visibleNavigation(account);
  const home = firstDestination(account);
  const collapsed = useSyncExternalStore(
    subscribePreference,
    readCollapsed,
    serverSnapshot,
  );
  const mobile = useSyncExternalStore(
    subscribeMobile,
    readMobile,
    serverSnapshot,
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLDialogElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!mobile) drawerRef.current?.close();
  }, [mobile]);
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [pathname]);
  function toggleNavigation() {
    if (mobile) {
      if (drawerRef.current?.open) drawerRef.current.close();
      else {
        drawerRef.current?.showModal();
        setDrawerOpen(true);
      }
      return;
    }
    fallbackCollapsed = !collapsed;
    try {
      window.localStorage.setItem(sidebarPreferenceKey, String(!collapsed));
    } catch {
      storageUnavailable = true;
    }
    window.dispatchEvent(new Event("talentflow-sidebar-change"));
  }
  function closeDrawer() {
    drawerRef.current?.close();
  }
  const isActive = (href: string) => isActiveRoute(pathname, href);
  const current =
    nav.flatMap((group) => group.items).find((item) => isActive(item.href))
      ?.label ??
    (pathname === "/no-access"
      ? "No access"
      : pathname.startsWith("/users/")
        ? "User details"
        : "Settings");

  const sidebarContent = (
    <>
      <Link href={home} className="brand">
        <span className="brand-mark">
          <span />
          <span />
          <span />
          <span />
        </span>
        <span>
          talent<span className="brand-light">flow</span>
        </span>
      </Link>
      <div className="workspace-switch">
        <div className="workspace-avatar">R</div>
        <div className="workspace-copy">
          <b>Resume workspace</b>
          <span>Enterprise workspace</span>
        </div>
        <span className="chevrons">⌄</span>
      </div>
      <nav className="side-nav" aria-label="Main navigation">
        {nav.map((group) => (
          <div className="nav-group" key={group.label}>
            <p className="nav-label">{group.label}</p>
            {group.items.map(({ label, icon, href }) => (
              <Link
                key={label}
                href={href}
                aria-label={label}
                title={label}
                aria-current={isActive(href) ? "page" : undefined}
                className={`nav-item ${isActive(href) ? "selected" : ""}`}
              >
                <Icon className="nav-icon">{icon}</Icon>
                <span>{label}</span>
              </Link>
            ))}
          </div>
        ))}
      </nav>
      <div className="sidebar-bottom">
        {can("settings.view") && (
          <Link
            className={`nav-item ${isActive("/settings") ? "selected" : ""}`}
            href="/settings"
            aria-label="Settings"
            title="Settings"
            aria-current={isActive("/settings") ? "page" : undefined}
          >
            <Icon className="nav-icon">⚙</Icon>
            <span>Settings</span>
          </Link>
        )}
        <div className="storage-card">
          <span>Resume files are stored privately.</span>
        </div>
        <div className="profile">
          <div className="profile-avatar">
            {account.email.slice(0, 2).toUpperCase()}
          </div>
          <div className="profile-copy">
            <b title={account.email}>{account.email}</b>
            <span>{account.role}</span>
          </div>
          {can("settings.view") && (
            <Link
              href="/settings"
              className="more-button"
              aria-label="Account options"
            >
              ···
            </Link>
          )}
        </div>
      </div>
    </>
  );

  return (
    <div
      className={`app-shell modern-workspace ${collapsed ? "sidebar-collapsed" : ""}`}
    >
      {!mobile && (
        <aside id="workspace-sidebar" className="sidebar">
          {sidebarContent}
        </aside>
      )}
      <dialog
        ref={drawerRef}
        id="workspace-drawer"
        className="workspace-drawer"
        aria-label="Workspace navigation"
        onClose={() => {
          setDrawerOpen(false);
          if (mobile) toggleRef.current?.focus();
        }}
        onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          if (
            event.target === event.currentTarget &&
            (event.clientX < bounds.left ||
              event.clientX > bounds.right ||
              event.clientY < bounds.top ||
              event.clientY > bounds.bottom)
          )
            closeDrawer();
        }}
      >
        {mobile && (
          <div
            className="drawer-sidebar"
            onClick={(event) => {
              if ((event.target as HTMLElement).closest("a")) closeDrawer();
            }}
          >
            <button
              type="button"
              className="drawer-close"
              aria-label="Close navigation"
              onClick={closeDrawer}
            >
              ×
            </button>
            {sidebarContent}
          </div>
        )}
      </dialog>
      <div className="main-area">
        <header className="topbar">
          <div className="header-navigation">
            <button
              ref={toggleRef}
              type="button"
              className="sidebar-toggle"
              aria-label={
                mobile
                  ? "Open navigation"
                  : collapsed
                    ? "Expand sidebar"
                    : "Collapse sidebar"
              }
              aria-expanded={mobile ? drawerOpen : !collapsed}
              aria-controls={mobile ? "workspace-drawer" : "workspace-sidebar"}
              onClick={toggleNavigation}
            >
              <Icon>{mobile ? "☰" : collapsed ? "›" : "‹"}</Icon>
            </button>
            <nav className="breadcrumbs" aria-label="Breadcrumb">
              <Link href={home}>Workspace</Link>
              <span aria-hidden="true">/</span>
              {pathname.startsWith("/resumes/") ? (
                <>
                  <Link href="/resumes">All resumes</Link>
                  <span aria-hidden="true">/</span>
                  <strong aria-current="page">Resume details</strong>
                </>
              ) : (
                <strong aria-current="page">{current}</strong>
              )}
            </nav>
          </div>
          <div className="top-actions">
            <ThemeToggle />
            {can("batches.view") && (
              <Link
                href="/batches"
                className="icon-button notification"
                aria-label="Processing activity"
              >
                ♧<i />
              </Link>
            )}
            <div className="top-divider" />
            <AccountMenu account={account} />
          </div>
        </header>
        <div
          ref={contentRef}
          className="workspace-scroll"
          tabIndex={0}
          role="region"
          aria-label="Workspace content"
        >
          <div className="page-content">
            {children}
            <footer className="page-footer">
              <span>© 2026 Talentflow, Inc.</span>
              {can("settings.view") && (
                <div>
                  <Link href="/settings">Help center</Link>
                  <Link href="/settings">Privacy</Link>
                  <Link href="/settings">
                    System status <i className="live-dot" />
                  </Link>
                </div>
              )}
            </footer>
          </div>
        </div>
      </div>
    </div>
  );
}
