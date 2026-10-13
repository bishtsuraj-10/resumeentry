import Link from "next/link";
import SignOutButton from "./sign-out-button";
import {
  firstDestination,
  type WorkspaceAccount,
} from "@/lib/workspace-access";
export default function NoAccess({
  account,
  forbidden = false,
}: {
  account: WorkspaceAccount;
  forbidden?: boolean;
}) {
  const destination = firstDestination(account);
  return (
    <main className="tool-page">
      <header className="tool-header">
        <div>
          <h1>{forbidden ? "Access denied" : "No workspace access"}</h1>
          <p>
            {forbidden
              ? "Your current permissions do not allow access to this page."
              : "Your account is active, but no workspace modules have been assigned."}
          </p>
        </div>
      </header>
      <section
        className="tool-panel access-state"
        role="region"
        aria-label="Access information"
      >
        <h2>
          {forbidden ? "Permission required" : "Contact your administrator"}
        </h2>
        <p>
          Ask a workspace administrator to review your role and additional
          permissions.
        </p>
        <div className="management-actions">
          {destination !== "/no-access" && (
            <Link className="button button-primary" href={destination}>
              Go to an available module
            </Link>
          )}
          <SignOutButton />
        </div>
      </section>
    </main>
  );
}
