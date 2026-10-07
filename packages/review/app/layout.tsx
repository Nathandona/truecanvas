import type { Metadata } from "next";

export const metadata: Metadata = { title: process.env.BRAND_NAME || "Design review", robots: { index: false, follow: false } };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" }}>{children}</body>
    </html>
  );
}
