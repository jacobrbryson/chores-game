import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { parseSessionToken } from "@/lib/auth/session";
import { isSupportAdmin } from "@/lib/support/access";
import SupportPageClient from "./support-page-client";

export default async function SupportPage() {
  const cookieStore = await cookies();
  const session = parseSessionToken(cookieStore.get("session_user")?.value);

  if (!isSupportAdmin(session)) {
    notFound();
  }

  return <SupportPageClient module="dashboard" />;
}
