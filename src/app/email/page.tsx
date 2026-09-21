import { redirect } from "next/navigation";
import { isAdminAuthenticated } from "@/lib/auth";
import { Nav, Card } from "@/components/ui";
import { TemplateEditor } from "@/components/template-editor";
import { ExperimentManager } from "@/components/experiment-manager";

export const dynamic = "force-dynamic";

export default async function EmailPage() {
  if (!(await isAdminAuthenticated())) redirect("/login");
  return (
    <>
      <Nav active="/email" />
      <main className="mx-auto max-w-6xl space-y-4 px-4 py-6">
        <Card title="Experiment campaign">
          <ExperimentManager />
        </Card>
        <Card title="Single template (fallback)">
          <p className="mb-3 text-xs text-zinc-500">
            Used when no experiment campaign is active. Saving here does not affect variants.
          </p>
          <TemplateEditor />
        </Card>
      </main>
    </>
  );
}
