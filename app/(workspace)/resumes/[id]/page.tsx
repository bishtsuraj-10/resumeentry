import PageAccess from "../../page-access";
import ResumeDetail from "./client";
export default async function Page({ params }: PageProps<"/resumes/[id]">) {
  const { id } = await params;
  return (
    <PageAccess
      permission="resumes.view"
      render={() => <ResumeDetail id={id} />}
    />
  );
}
