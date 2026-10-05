// Frame presets. `device` on a <Frame> adds device chrome in the editor and
// mobile emulation (touch, pixel ratio) for agent screenshots.

export interface Device {
  id: string;
  name: string;
  kind: "phone" | "tablet" | "desktop";
  width: number;
  height: number;
  /** device pixel ratio */
  dpr: number;
  /** status bar height (phones/tablets) */
  statusBar: number;
  /** home indicator area at the bottom */
  homeIndicator: number;
  /** screen corner radius */
  radius: number;
  /** dynamic island / notch */
  island?: boolean;
}

export const DEVICES: Device[] = [
  { id: "iphone-16", name: "iPhone 16", kind: "phone", width: 393, height: 852, dpr: 3, statusBar: 54, homeIndicator: 34, radius: 55, island: true },
  { id: "iphone-16-pro-max", name: "iPhone 16 Pro Max", kind: "phone", width: 440, height: 956, dpr: 3, statusBar: 54, homeIndicator: 34, radius: 62, island: true },
  { id: "iphone-se", name: "iPhone SE", kind: "phone", width: 375, height: 667, dpr: 2, statusBar: 20, homeIndicator: 0, radius: 0 },
  { id: "pixel-9", name: "Pixel 9", kind: "phone", width: 412, height: 923, dpr: 2.625, statusBar: 36, homeIndicator: 24, radius: 48 },
  { id: "galaxy-s24", name: "Galaxy S24", kind: "phone", width: 360, height: 780, dpr: 3, statusBar: 32, homeIndicator: 24, radius: 44 },
  { id: "ipad-mini", name: "iPad mini", kind: "tablet", width: 744, height: 1133, dpr: 2, statusBar: 24, homeIndicator: 20, radius: 22 },
  { id: "ipad-pro-11", name: "iPad Pro 11″", kind: "tablet", width: 834, height: 1210, dpr: 2, statusBar: 24, homeIndicator: 20, radius: 18 },
  { id: "laptop", name: "Laptop", kind: "desktop", width: 1280, height: 800, dpr: 2, statusBar: 0, homeIndicator: 0, radius: 0 },
  { id: "desktop", name: "Desktop", kind: "desktop", width: 1440, height: 900, dpr: 1, statusBar: 0, homeIndicator: 0, radius: 0 },
  { id: "desktop-hd", name: "Desktop HD", kind: "desktop", width: 1920, height: 1080, dpr: 1, statusBar: 0, homeIndicator: 0, radius: 0 },
];

export function findDevice(id: string | null | undefined): Device | undefined {
  return id ? DEVICES.find((d) => d.id === id) : undefined;
}
