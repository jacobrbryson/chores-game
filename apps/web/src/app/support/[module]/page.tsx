import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { parseSessionToken } from "@/lib/auth/session";
import { isSupportAdmin } from "@/lib/support/access";
import { isSupportModule } from "@/lib/support/modules";
import SupportPageClient from "../support-page-client";

export default async function SupportModulePage({
  params,
}: {
  params: Promise<{ module: string }>;
}) {
  const cookieStore = await cookies();
  const session = parseSessionToken(cookieStore.get("session_user")?.value);
  const { module } = await params;

  if (!isSupportAdmin(session) || !isSupportModule(module) || module === "requests") {
    notFound();
  }

  return <SupportPageClient module={module} />;
}
