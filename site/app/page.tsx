import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Hero } from "@/components/hero";
import { WorksWith } from "@/components/works-with";
import { Features } from "@/components/features";
import { HowItWorks } from "@/components/how-it-works";
import { AgentPrompts } from "@/components/agent-prompts";
import { Collaborate } from "@/components/collaborate";
import { GetStarted } from "@/components/get-started";

export default function Home() {
  return (
    <main className="flex flex-col">
      <SiteHeader />
      <Hero />
      <WorksWith />
      <Features />
      <HowItWorks />
      <AgentPrompts />
      <Collaborate />
      <GetStarted />
      <SiteFooter />
    </main>
  );
}
