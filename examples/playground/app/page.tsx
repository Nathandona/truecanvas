import { Composer } from "@/components/app/composer";
import { Message } from "@/components/app/message";
import { PageHeader } from "@/components/app/page-header";
import { PageLayout } from "@/components/app/page-layout";
import { SessionRow } from "@/components/app/session-row";
import { Sidebar } from "@/components/app/sidebar";
import { SidebarLink } from "@/components/app/sidebar-link";
import { SidebarSection } from "@/components/app/sidebar-section";
import { ToolCall } from "@/components/app/tool-call";

export default function Home() {
  return (
    <div className="h-dvh">
      <PageLayout>
        <Sidebar workspace="Acme">
          <SidebarLink label="New session" icon="new" />
          <SidebarLink label="Home" icon="home" />
          <SidebarLink label="Reports" icon="reports" />
          <SidebarLink label="Automations" icon="automations" />
          <SidebarLink label="Integrations" icon="integrations" />
          <SidebarLink label="Settings" icon="settings" />
          <SidebarSection title="Sessions">
            <SessionRow title="Review release readiness" status="working" source="web" elapsed="2m" active />
            <SessionRow title="Draft the Q4 changelog" status="review" source="slack" elapsed="3h" unread />
            <SessionRow title="Migrate billing webhooks" status="working" source="github" elapsed="3h" />
            <SessionRow title="Triage onboarding bugs" status="review" source="linear" elapsed="5h" />
            <SessionRow title="Fix the flaky billing test" status="idle" source="web" elapsed="1d" />
            <SessionRow title="Rehearse the staging migration" status="failed" source="slack" elapsed="2d" />
            <SessionRow title="Update the API reference" status="done" source="github" elapsed="3d" />
          </SidebarSection>
        </Sidebar>
        <main className="flex min-w-0 flex-1 flex-col">
          <PageHeader title="Review release readiness" status="active" pullRequests={2} private participants="MC +1" />
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-8 py-6">
            <Message author="Ada Lovelace" via="web">
              Check the release readiness checklist before next week&apos;s launch.
            </Message>
            <ToolCall verb="Read" detail="deployment status · 4 services" />
            <ToolCall verb="Searched" detail="migrations · staging" />
            <Message role="agent">The release is close. The staging migration still needs a production-sized rehearsal.</Message>
          </div>
          <div className="px-8 pb-6">
            <Composer />
          </div>
        </main>
      </PageLayout>
    </div>
  );
}
