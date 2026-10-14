import PageAccess from "../page-access";
import ResumeList from "../resume-list";
export default function Page() {
  return (
    <PageAccess
      permission="resumes.view"
      render={() => <ResumeList title="Review queue" status="REVIEW" />}
    />
  );
}
