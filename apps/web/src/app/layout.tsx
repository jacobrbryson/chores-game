import type { Metadata } from "next";
import "./globals.css";
import { AppHeader } from "@/components/app-header";

export const metadata: Metadata = {
  title: "Family Chores",
  description:
    "A family chore game where kids complete quests and parents approve rewards.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
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
