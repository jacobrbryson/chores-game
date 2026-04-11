import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";
import { AppFooter } from "@/components/app-footer";
import { AppHeader } from "@/components/app-header";
import { NavigationHistoryTracker } from "@/components/navigation-history-tracker";
import { PartyConfettiOverlay } from "@/components/party-confetti-overlay";
import { ThemePreferenceSync } from "@/components/theme-preference-sync";

export const metadata: Metadata = {
  title: "Family Chores",
  description:
    "A family chore system with parent approval, rewards, Google integration, and live household activity.",
  icons: {
    icon: [
      { url: "/icons/favicon-96x96.png", sizes: "96x96", type: "image/png" },
      { url: "/icons/favicon.svg", type: "image/svg+xml" },
    ],
    shortcut: "/icons/favicon.ico",
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  manifest: "/icons/site.webmanifest",
  appleWebApp: {
    title: "Family Chores",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Jim+Nightshade&family=Luckiest+Guy&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased">
        <Suspense fallback={null}>
          <NavigationHistoryTracker />
        </Suspense>
        <ThemePreferenceSync />
        <PartyConfettiOverlay />
        <div className="shell">
          <div className="container app-layout">
            <div className="app-main">
              <AppHeader />
              {children}
            </div>
            <AppFooter />
          </div>
        </div>
      </body>
    </html>
  );
}
