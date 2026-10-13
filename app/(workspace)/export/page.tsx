import PageAccess from "../page-access";
import Export from "./client";
export default function Page() {
  return <PageAccess permission="resumes.export" render={() => <Export />} />;
}
