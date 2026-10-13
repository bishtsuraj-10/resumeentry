"use client";
import Link from "next/link";
import ThemeToggle from "../../theme-toggle";
import {
  firstDestination,
  type WorkspaceAccount,
} from "@/lib/workspace-access";
import { useRouter } from "next/navigation";

import { useState } from "react";
import { useEffect } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/auth/session", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.ok)
          router.replace(
            firstDestination((await response.json()) as WorkspaceAccount),
          );
      })
      .catch(() => {});
    return () => controller.abort();
  }, [router]);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (response.ok) {
        setPassword("");
        const current = await fetch("/api/auth/session", { cache: "no-store" });
        if (!current.ok) throw new Error("Session unavailable");
        router.replace(
          firstDestination((await current.json()) as WorkspaceAccount),
        );
        router.refresh();
        return;
      }
      const data = await response.json().catch(() => null);
      setError(data?.error ?? "Could not sign in. Please try again.");
    } catch {
      setError(
        "Could not reach the server. Check that the app is running and try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <div className="login-card">
        <div className="login-top">
          <Link href="/" className="brand login-brand">
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
          <ThemeToggle />
        </div>
        <div className="login-heading">
          <h1>Welcome back</h1>
          <p>Sign in to your Talentflow workspace.</p>
        </div>
        <form onSubmit={submit}>
          <label>
            Email address
            <input
              required
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label>
            Password
            <input
              required
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {error && (
            <p className="login-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="button button-primary login-submit"
            disabled={busy}
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="login-foot">
          Access is managed by your workspace administrator.
        </p>
      </div>
    </main>
  );
}
