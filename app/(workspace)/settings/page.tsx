import PageAccess from "../page-access";
import Settings from "./client";
export default function Page() {
  return <PageAccess permission="settings.view" render={() => <Settings />} />;
}
