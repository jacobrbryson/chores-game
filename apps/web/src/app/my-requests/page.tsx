import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { MyRequestsPageClient } from "@/components/my-requests-page-client";
import { parseSessionToken } from "@/lib/auth/session";

export default async function MyRequestsPage() {
  const cookieStore = await cookies();
  const sessionUser = parseSessionToken(cookieStore.get("session_user")?.value);

  if (!sessionUser) {
    redirect("/");
  }

  return <MyRequestsPageClient />;
}
