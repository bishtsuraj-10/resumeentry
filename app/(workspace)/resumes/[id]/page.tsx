import PageAccess from "../../page-access";
import ResumeDetail from "./client";
export default function Page(props: PageProps<"/resumes/[id]">) {
  return (
    <PageAccess
      permission="resumes.view"
      render={() => <ResumeDetail {...props} />}
    />
  );
}
