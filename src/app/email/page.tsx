import { redirect } from "next/navigation";
import { isAdminAuthenticated } from "@/lib/auth";
import { Nav, Card } from "@/components/ui";
import { TemplateEditor } from "@/components/template-editor";

export const dynamic = "force-dynamic";

export default async function EmailPage() {
  if (!(await isAdminAuthenticated())) redirect("/login");
  return (
    <>
      <Nav active="/email" />
      <main className="mx-auto max-w-6xl space-y-4 px-4 py-6">
        <Card title="Email template">
          <TemplateEditor />
        </Card>
      </main>
    </>
  );
}
