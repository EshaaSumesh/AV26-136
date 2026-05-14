import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ResQRoute — AI Rescue Route Optimization",
  description:
    "Multi-agent AI for India's disaster response infrastructure. Six autonomous agents reason over real-time traffic, weather, and hazard data to dispatch the safest, fastest rescue routes — with full reasoning transparency.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
