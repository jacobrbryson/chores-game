import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { createTranslator } from "@packages/locales";
import { ChangeLogDateContent, formatChangeLogGroupDate } from "@/components/change-log-page";
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
      title: "Change Log",
      description: "Read the latest Family Chores app updates and fixes.",
    };
  }

  const formattedDate = formatChangeLogGroupDate(group, DEFAULT_LOCALE);
  const description = `Family Chores app updates and fixes published on ${formattedDate}.`;

  return {
    title: `Change Log — ${formattedDate}`,
    description,
    alternates: { canonical: `/change-log/${group.slug}` },
    openGraph: {
      type: "article",
      title: `Change Log — ${formattedDate} | Family Chores`,
      description,
      url: `/change-log/${group.slug}`,
    },
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

  return <ChangeLogDateContent date={group.slug} locale={locale} t={t} />;
}
