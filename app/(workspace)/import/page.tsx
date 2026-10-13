import PageAccess from "../page-access";
import Import from "./client";
export default function Page() {
  return <PageAccess permission="resumes.import" render={() => <Import />} />;
}
