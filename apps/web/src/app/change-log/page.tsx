import type { Metadata } from "next";
import { cookies } from "next/headers";
import { createTranslator } from "@packages/locales";
import { ChangeLogIndexContent } from "@/components/change-log-page";
import { parseSessionToken } from "@/lib/auth/session";
import { DEFAULT_LOCALE } from "@/lib/locale";

export const metadata: Metadata = {
  title: "Change Log | Family Chores",
  description: "Read the latest Family Chores app updates and fixes.",
};

export default async function ChangeLogRoute() {
  const cookieStore = await cookies();
  const sessionUser = parseSessionToken(cookieStore.get("session_user")?.value);
  const locale = sessionUser?.locale || DEFAULT_LOCALE;
  const t = createTranslator({ locale });

  // Discovery seen-state for the Recent/Requested tabs is handled inside
  // ChangeLogTabs (each tab marks its own section seen on view).
  return <ChangeLogIndexContent locale={locale} t={t} />;
}
