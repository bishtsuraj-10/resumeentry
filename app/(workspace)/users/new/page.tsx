import PageAccess from "../../page-access";
import CreateUser from "./create-user";
export default function Page() {
  return <PageAccess permission="users.create" render={() => <CreateUser />} />;
}
