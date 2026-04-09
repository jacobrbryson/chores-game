import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { FamilyMemberProfileClient } from "@/components/family-member-profile-client";
import { parseSessionToken } from "@/lib/auth/session";

export default async function FamilyMemberProfilePage({
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

  return <FamilyMemberProfileClient memberId={uuid} />;
}
