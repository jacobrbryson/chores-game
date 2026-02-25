import type { Metadata } from "next";
import "./globals.css";
import { AppHeader } from "@/components/app-header";
import { ThemePreferenceSync } from "@/components/theme-preference-sync";

export const metadata: Metadata = {
  title: "Family Chores",
  description:
    "A family chore game where kids complete quests and parents approve rewards.",
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
      <body className="antialiased">
        <ThemePreferenceSync />
        <div className="shell">
          <div className="container">
            <AppHeader />
            {children}
          </div>
        </div>
      </body>
    </html>
  );
}
