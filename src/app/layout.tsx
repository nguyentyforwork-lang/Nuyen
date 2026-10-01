import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TikTok Ads Control Center",
  description: "Internal agency dashboard: report, monitor, diagnose, suggest, confirm, execute, audit.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full text-[13px]">{children}</body>
    </html>
  );
}
