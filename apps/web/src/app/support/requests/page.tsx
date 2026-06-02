import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { parseSessionToken } from "@/lib/auth/session";
import { isSupportAdmin } from "@/lib/support/access";
import SupportRequestsPageClient from "./support-requests-page-client";

export default async function SupportRequestsPage() {
  const cookieStore = await cookies();
  const session = parseSessionToken(cookieStore.get("session_user")?.value);

  if (!isSupportAdmin(session)) {
    notFound();
  }

  return <SupportRequestsPageClient />;
}
