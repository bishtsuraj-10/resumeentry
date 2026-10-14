import PageAccess from "../../page-access";
import ResumeDetail from "./client";
export default function Page({ params }: PageProps<"/resumes/[id]">) {
  return (
    <PageAccess
      permission="resumes.view"
      render={async () => {
        // PageAccess invokes this inside its Suspense boundary after authorization.
        const { id } = await params;
        return <ResumeDetail id={id} />;
      }}
    />
  );
}
