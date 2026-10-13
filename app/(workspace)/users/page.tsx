import PageAccess from "../page-access";
import Users from "./users-client";
export default function Page() {
  return <PageAccess permission="users.view" render={() => <Users />} />;
}
