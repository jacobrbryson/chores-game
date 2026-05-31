import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Suspense } from "react";
import "./globals.css";
import { AppBreadcrumbs } from "@/components/app-breadcrumbs";
import { AppFooter } from "@/components/app-footer";
import { AppHeader } from "@/components/app-header";
import { AchievementUnlockListener } from "@/components/achievements/achievement-unlock-listener";
import { LocaleProvider } from "@/components/locale-provider";
import { NavigationHistoryTracker } from "@/components/navigation-history-tracker";
import { PartyConfettiOverlay } from "@/components/party-confetti-overlay";
import { ThemePreferenceSync } from "@/components/theme-preference-sync";
import { parseSessionToken } from "@/lib/auth/session";
import { DEFAULT_LOCALE } from "@/lib/locale";

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
  const cookieStore = await cookies();
  const sessionUser = parseSessionToken(cookieStore.get("session_user")?.value);
  const locale = sessionUser?.locale || DEFAULT_LOCALE;

  return (
    <html lang={locale}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Jim+Nightshade&family=Luckiest+Guy&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased">
        <LocaleProvider initialLocale={locale}>
          <Suspense fallback={null}>
            <NavigationHistoryTracker />
          </Suspense>
          <ThemePreferenceSync />
          <PartyConfettiOverlay />
          <AchievementUnlockListener />
          <div className="shell">
            <div className="container app-layout">
              <div className="app-main">
                <AppHeader />
                <AppBreadcrumbs hideGuestHomepage={!sessionUser} />
                {children}
              </div>
              <AppFooter locale={locale} />
            </div>
          </div>
        </LocaleProvider>
      </body>
    </html>
  );
}
