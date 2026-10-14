import PageAccess from "../page-access";
import Batches from "./client";
export default function Page() {
  return <PageAccess permission="batches.view" render={() => <Batches />} />;
}
