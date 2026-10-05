"use client";
import { Canvas, Frame } from "truecanvas";
import HomePage from "@/app/page";

/** Your homepage, linked to app/page.tsx: editing its layers edits that file. */
export default function HomeCanvas() {
  return (
    <Canvas>
      <Frame name="Home" x={0} y={0} width={1440} page="app/page.tsx">
        <HomePage />
      </Frame>
      <Frame name="Home mobile" x={1520} y={0} width={393} page="app/page.tsx" device="iphone-16">
        <HomePage />
      </Frame>
    </Canvas>
  );
}
