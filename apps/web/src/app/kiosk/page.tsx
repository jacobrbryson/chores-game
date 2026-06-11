import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { KioskActiveClient } from "@/components/kiosk-active-client";
import { KioskEntryClient } from "@/components/kiosk-entry-client";
import { getSessionIdentity, isKioskActive, parseSessionToken } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Kiosk Mode",
  description: "Shared family tablet mode for completing chores.",
  robots: { index: false, follow: false },
  alternates: { canonical: "/kiosk" },
};

// Shared-family tablet experience. When a kiosk session is active the page
// renders the focused checklist for the selected player; otherwise it shows the
// player selector that starts Kiosk Mode. The signed-in account and the active
// kiosk player are always tracked separately (see lib/auth/session.ts), and the
// active session is always player-level regardless of the real account role.
export default async function KioskPage() {
  const cookieStore = await cookies();
  const session = parseSessionToken(cookieStore.get("session_user")?.value);
  if (!session) {
    redirect("/");
  }

  if (isKioskActive(session)) {
    const player = getSessionIdentity(session);
    return (
      <main className="kiosk-page">
        <KioskActiveClient
          playerName={player.name}
          playerEmail={player.email}
          playerInitial={(player.name || player.email || "?").trim().charAt(0).toUpperCase()}
        />
      </main>
    );
  }

  return (
    <main className="kiosk-page">
      <KioskEntryClient />
    </main>
  );
}
