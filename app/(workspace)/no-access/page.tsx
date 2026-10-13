import { redirect } from "next/navigation";
import { firstDestination } from "@/lib/workspace-access";
import PageAccess, { NoAccess } from "../page-access";
export default function Page() {
  return (
    <PageAccess
      render={(account) => {
        const destination = firstDestination(account);
        if (destination !== "/no-access") redirect(destination);
        return <NoAccess account={account} />;
      }}
    />
  );
}
