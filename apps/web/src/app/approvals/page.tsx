import type { Metadata } from "next";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { parseSessionToken } from "@/lib/auth/session";
import ApprovalsClient from "./approvals-client";

// Parent-only Approval Inbox. Signed-out visitors are redirected home; the client
// performs the authoritative admin check against the chores API (it resolves the
// viewer's real family role) and redirects children away.

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Approval Inbox | Family Chores" },
  robots: { index: false, follow: false },
  alternates: { canonical: "/approvals" },
};

export default async function ApprovalsRoute() {
  const cookieStore = await cookies();
  const sessionUser = parseSessionToken(cookieStore.get("session_user")?.value);
  if (!sessionUser) {
    redirect("/");
  }
  return (
    <main className="dashboard">
      <Suspense fallback={null}>
        <ApprovalsClient />
      </Suspense>
    </main>
  );
}
