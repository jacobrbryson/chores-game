import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { FamilyMemberItemsPageClient } from "@/components/family-member-items-page-client";
import { parseSessionToken } from "@/lib/auth/session";

export default async function FamilyMemberItemsPage({
  params,
}: {
  params: Promise<{ uuid: string }>;
}) {
  const { uuid } = await params;
  const cookieStore = await cookies();
  const sessionUser = parseSessionToken(cookieStore.get("session_user")?.value);

  if (!sessionUser) {
    redirect("/");
  }

  return <FamilyMemberItemsPageClient memberId={uuid} />;
}

