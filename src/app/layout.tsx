import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LocalAction Email Scheduler",
  description: "Private admin tool for LocalAction outreach emails.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-zinc-100 text-zinc-900 antialiased">
        {children}
      </body>
    </html>
  );
}
