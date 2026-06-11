import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Suspense } from "react";
import "./globals.css";
import { AppBreadcrumbs } from "@/components/app-breadcrumbs";
import { AppFooter } from "@/components/app-footer";
import { AppHeader } from "@/components/app-header";
import { AchievementUnlockListener } from "@/components/achievements/achievement-unlock-listener";
import { DiagnosticsBootstrap } from "@/components/diagnostics-bootstrap";
import { LocaleProvider } from "@/components/locale-provider";
import { NavigationHistoryTracker } from "@/components/navigation-history-tracker";
import { PartyConfettiOverlay } from "@/components/party-confetti-overlay";
import { ThemePreferenceSync } from "@/components/theme-preference-sync";
import { ToastViewport } from "@/components/toast";
import { isKioskActive, parseSessionToken } from "@/lib/auth/session";
import { DEFAULT_LOCALE } from "@/lib/locale";
import { NotFoundProvider } from "@/lib/not-found-context";
import { DEFAULT_OG_IMAGE, SITE_URL } from "@/lib/seo";

const DEFAULT_DESCRIPTION =
  "A family chore system with parent approval, rewards, Google integration, and live household activity.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Family Chores",
    template: "%s | Family Chores",
  },
  description: DEFAULT_DESCRIPTION,
  applicationName: "Family Chores",
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
  openGraph: {
    type: "website",
    siteName: "Family Chores",
    title: "Family Chores",
    description: DEFAULT_DESCRIPTION,
    url: SITE_URL,
    images: [{ url: DEFAULT_OG_IMAGE, width: 1200, height: 630, alt: "Family Chores" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Family Chores",
    description: DEFAULT_DESCRIPTION,
    images: [DEFAULT_OG_IMAGE],
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
  // In Kiosk Mode the shared-tablet experience hides app navigation, breadcrumbs
  // and footer to stay focused and avoid exposing full app navigation.
  const kioskActive = sessionUser ? isKioskActive(sessionUser) : false;

  return (
    <html lang={locale}>
      <head>
        <script async src="https://www.googletagmanager.com/gtag/js?id=G-GM3MZZ6NXK"></script>
        <script
          dangerouslySetInnerHTML={{
            __html: `window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', 'G-GM3MZZ6NXK');`,
          }}
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Jim+Nightshade&family=Luckiest+Guy&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased">
        <NotFoundProvider>
        <LocaleProvider initialLocale={locale}>
          <Suspense fallback={null}>
            <NavigationHistoryTracker />
          </Suspense>
          <ThemePreferenceSync />
          <DiagnosticsBootstrap />
          <PartyConfettiOverlay />
          <AchievementUnlockListener />
          <ToastViewport />
          <div className="shell">
            <div className="container app-layout">
              <div className="app-main">
                <AppHeader />
                {!kioskActive ? <AppBreadcrumbs hideGuestHomepage={!sessionUser} /> : null}
                {children}
              </div>
              {!kioskActive ? <AppFooter locale={locale} authed={Boolean(sessionUser)} /> : null}
            </div>
          </div>
        </LocaleProvider>
        </NotFoundProvider>
      </body>
    </html>
  );
}
