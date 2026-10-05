"use client";
import { Canvas, Frame } from "truecanvas";
import { Step } from "@/components/step";
import { Hero } from "@/components/hero";
import { Collaborate } from "@/components/collaborate";
import { WorksWith } from "@/components/works-with";
import { HowItWorks } from "@/components/how-it-works";
import { AgentPrompts } from "@/components/agent-prompts";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Features } from "@/components/features";
import { GetStarted } from "@/components/get-started";

/** Main components: edit one here and every instance in the app follows. */
export default function ComponentsCanvas() {
  return (
    <Canvas>
      <Frame name="Step" x={0} y={0} width={640} component="components/step.tsx#Step">
        <div className="p-10">
          <Step />
        </div>
      </Frame>
      <Frame name="Hero" x={720} y={0} width={1440} component="components/hero.tsx#Hero">
        <div className="p-10">
          <Hero />
        </div>
      </Frame>
      <Frame
        name="Collaborate"
        x={1440}
        y={0}
        width={640}
        component="components/collaborate.tsx#Collaborate"
      >
        <div className="p-10">
          <Collaborate />
        </div>
      </Frame>
      <Frame
        name="WorksWith"
        x={2160}
        y={0}
        width={1280}
        component="components/works-with.tsx#WorksWith"
      >
        <div className="p-10">
          <WorksWith />
        </div>
      </Frame>
      <Frame
        name="HowItWorks"
        x={3520}
        y={0}
        width={1280}
        component="components/how-it-works.tsx#HowItWorks"
      >
        <div className="p-10">
          <HowItWorks />
        </div>
      </Frame>
      <Frame
        name="AgentPrompts"
        x={4880}
        y={0}
        width={1280}
        component="components/agent-prompts.tsx#AgentPrompts"
      >
        <div className="p-10">
          <AgentPrompts />
        </div>
      </Frame>
      <Frame
        name="SiteFooter"
        x={6240}
        y={0}
        width={1280}
        component="components/site-footer.tsx#SiteFooter"
      >
        <div className="p-10">
          <SiteFooter />
        </div>
      </Frame>
      <Frame
        name="SiteHeader"
        x={7600}
        y={0}
        width={640}
        component="components/site-header.tsx#SiteHeader"
      >
        <div className="p-10">
          <SiteHeader />
        </div>
      </Frame>
      <Frame
        name="Features"
        x={8320}
        y={0}
        width={1280}
        component="components/features.tsx#Features"
      >
        <div className="p-10">
          <Features />
        </div>
      </Frame>
      <Frame
        name="GetStarted"
        x={9680}
        y={0}
        width={1280}
        component="components/get-started.tsx#GetStarted"
      >
        <div className="p-10">
          <GetStarted />
        </div>
      </Frame>
    </Canvas>
  );
}
