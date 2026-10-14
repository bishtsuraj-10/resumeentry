"use client";
import Link from "next/link";
import { useCan } from "../workspace-access";
import { PageHeader } from "./management-ui";
import UserList from "./user-list";
export default function Users() {
  const can = useCan();
  return (
    <main className="tool-page user-management">
      <PageHeader
        title="All Users"
        description="Manage workspace accounts and their access."
      >
        {can("users.create") && (
          <Link className="button button-primary" href="/users/new">
            ＋ Add User
          </Link>
        )}
      </PageHeader>
      <UserList />
    </main>
  );
}
