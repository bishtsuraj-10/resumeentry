import PageAccess from "./page-access";
import Dashboard from "./dashboard-client";
export default function HomePage() {
  return (
    <PageAccess permission="dashboard.view" render={() => <Dashboard />} />
  );
}
