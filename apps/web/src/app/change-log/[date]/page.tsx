import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { createTranslator } from "@packages/locales";
import { ChangeLogDateContent } from "@/components/change-log-page";
import { parseSessionToken } from "@/lib/auth/session";
import { getChangeLogEntryGroup } from "@/lib/change-log";
import { DEFAULT_LOCALE } from "@/lib/locale";

type Props = {
  params: Promise<{ date: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { date } = await params;
  const group = getChangeLogEntryGroup(date);
  if (!group) {
    return {
      title: "Change Log | Family Chores",
      description: "Read the latest Family Chores app updates and fixes.",
    };
  }

  return {
    title: `${date} | Change Log | Family Chores`,
    description: `Read the Family Chores updates and fixes published on ${date}.`,
  };
}

export default async function ChangeLogDateRoute({ params }: Props) {
  const { date } = await params;
  const group = getChangeLogEntryGroup(date);
  if (!group) {
    notFound();
  }

  const cookieStore = await cookies();
  const sessionUser = parseSessionToken(cookieStore.get("session_user")?.value);
  const locale = sessionUser?.locale || DEFAULT_LOCALE;
  const t = createTranslator({ locale });

  return <ChangeLogDateContent date={group.date} locale={locale} t={t} />;
}
