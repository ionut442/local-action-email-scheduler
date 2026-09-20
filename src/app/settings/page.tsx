import { redirect } from "next/navigation";
import { isAdminAuthenticated } from "@/lib/auth";
import { Nav, Card } from "@/components/ui";
import { SettingsForm } from "@/components/settings-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  if (!(await isAdminAuthenticated())) redirect("/login");
  return (
    <>
      <Nav active="/settings" />
      <main className="mx-auto max-w-6xl space-y-4 px-4 py-6">
        <Card title="Settings">
          <SettingsForm />
        </Card>
      </main>
    </>
  );
}
