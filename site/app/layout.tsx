import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const description = "An open-source canvas for your React app: every layer is your code, your agent edits through MCP, and design changes ship as pull requests.";

export const metadata: Metadata = {
  metadataBase: new URL("https://truecanvas.dev"),
  title: "Truecanvas · Design with your real components",
  description,
  alternates: { canonical: "/" },
  openGraph: { type: "website", url: "/", siteName: "Truecanvas", title: "Truecanvas · Design with your real components", description },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
