import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chore Quest",
  description:
    "A family chore game where kids complete quests and parents approve rewards.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
