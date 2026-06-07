import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { parseSessionToken } from "@/lib/auth/session";

export default async function FamilyLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const session = parseSessionToken(cookieStore.get("session_user")?.value);

  if (!session) {
    redirect("/");
  }

  return <>{children}</>;
}
