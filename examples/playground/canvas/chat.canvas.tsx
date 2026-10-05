"use client";

import { Canvas, Frame } from "truecanvas";
import { Composer } from "@/components/app/composer";
import { Message } from "@/components/app/message";
import { PageHeader } from "@/components/app/page-header";
import { PageLayout } from "@/components/app/page-layout";
import { SessionRow } from "@/components/app/session-row";
import { SettingsCard } from "@/components/app/settings-card";
import { SettingsRow } from "@/components/app/settings-row";
import { Sidebar } from "@/components/app/sidebar";
import { SidebarLink } from "@/components/app/sidebar-link";
import { SidebarSection } from "@/components/app/sidebar-section";
import { ToolCall } from "@/components/app/tool-call";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MeshGradient } from "@paper-design/shaders-react";
import { Avatar } from "@/components/ui/avatar";

export default function ChatCanvas() {
  return (
    <Canvas>
      <Frame name="Settings" x={0} y={-460} width={420}>
        <SettingsCard title="Production access" description="Decide who can open sessions against production.">
          <SettingsRow title="Require approvals" description="Two reviewers must approve." control="switch" checked />
          <SettingsRow title="Audit log" description="Applies to every session." control="badge" checked />
        </SettingsCard>
      </Frame>
      <Frame name="Settings dark" x={460} y={-460} width={420} theme="dark">
        <SettingsCard title="Production access" description="Decide who can open sessions against production.">
          <SettingsRow title="Require approvals" description="Two reviewers must approve." control="switch" checked />
          <SettingsRow title="Audit log" description="Applies to every session." control="badge" checked />
        </SettingsCard>
      </Frame>
      <Frame name="Chat" x={0} y={0} width={1120} height={720}>
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
          <div className="flex min-w-0 flex-1 flex-col">
            <PageHeader title="Review release readiness" status="active" pullRequests={2} private participants="MC +1" />
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-8 py-6">
              <Message author="Ada Lovelace" via="web">Check the release readiness checklist before next week's launch.</Message>
              <ToolCall verb="Read" detail="deployment status · 4 services" />
              <ToolCall verb="Searched" detail="migrations · staging" />
              <Message role="agent">The release is close. The staging migration still needs a production-sized rehearsal.</Message>
              <Message author="Ada Lovelace" via="web">Schedule the rehearsal for Thursday and loop in the on-call engineer.</Message>
              <ToolCall verb="Running" detail="calendar · create event" state="running" />
            </div>
            <div className="px-8 pb-6">
              <Composer placeholder="Ask anything" model="Opus 5.5" environment="Production" repository="web" />
            </div>
          </div>
        </PageLayout>
      </Frame>
      <Frame name="Session row states" x={1180} y={0} width={320}>
        <div className="flex flex-col gap-1 p-3">
          <SessionRow title="Working session" status="working" source="web" elapsed="2m" />
          <SessionRow title="Idle session" status="idle" source="slack" elapsed="1h" />
          <SessionRow title="Waiting for review" status="review" source="github" elapsed="3h" unread />
          <SessionRow title="Failed session" status="failed" source="linear" elapsed="1d" />
          <SessionRow title="Finished session" status="done" source="web" elapsed="2d" active />
        </div>
      </Frame>
      <Frame name="Sessions mobile" x={1580} y={-460} width={393} height={852} device="iphone-16">
        <div className="flex h-full flex-col bg-background pt-14">
          <div className="px-4 pb-2 text-lg font-semibold">Sessions</div>
          <div className="flex flex-col gap-1 px-2">
            <SessionRow title="Review release readiness" status="working" elapsed="2m" active />
            <SessionRow
              title="Draft the Q4 changelog"
              status="review"
              source="slack"
              elapsed="3h"
              unread
            />
            <SessionRow title="Fix the flaky billing test" status="idle" elapsed="1d" />
          </div>
        </div>
      </Frame>
      <Frame name="Hero" x={2053} y={-460} width={720}>
        <div className="relative isolate flex flex-col items-center gap-4 px-12 py-20 text-center">
          <MeshGradient className="pointer-events-none absolute inset-0 -z-10 h-full w-full" speed={0.6} colors={["#aaa7d7", "#3c2b8e"]} distortion={1} swirl={1} />
          <Badge dot tone="accent">
            New
          </Badge>
          <h1 className="text-4xl font-semibold tracking-tight text-white">Ship with agents</h1>
          <p className="max-w-md text-base text-white/80">
            Review, plan and release with your whole team.
          </p>
          <Button variant="primary">Start a session</Button>
        </div>
      </Frame>
    </Canvas>
  );
}
