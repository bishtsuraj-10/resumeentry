import PageAccess from "../page-access";
import Permissions from "./permissions-client";
export default function Page() {
  return <PageAccess permission="roles.view" render={() => <Permissions />} />;
}
