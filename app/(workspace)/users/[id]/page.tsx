import PageAccess from "../../page-access";
import UserDetail from "./user-detail";
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <PageAccess
      permission="users.view"
      render={async () => {
        const { id } = await params;
        return <UserDetail key={id} id={id} />;
      }}
    />
  );
}
