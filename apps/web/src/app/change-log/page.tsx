import type { Metadata } from "next";
import { cookies } from "next/headers";
import { createTranslator } from "@packages/locales";
import { ChangeLogIndexContent } from "@/components/change-log-page";
import { parseSessionToken } from "@/lib/auth/session";
import { DEFAULT_LOCALE } from "@/lib/locale";

const CHANGE_LOG_DESCRIPTION = "Read the latest Family Chores app updates and fixes.";

export const metadata: Metadata = {
  title: "Change Log",
  description: CHANGE_LOG_DESCRIPTION,
  alternates: { canonical: "/change-log" },
  openGraph: {
    type: "website",
    title: "Change Log | Family Chores",
    description: CHANGE_LOG_DESCRIPTION,
    url: "/change-log",
  },
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
