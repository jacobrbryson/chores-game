import type { Metadata } from "next";
import { cookies } from "next/headers";
import {
  MarketingRoutinesPage,
  routinesFaqStructuredData,
} from "@/components/marketing-routines-page";
import { RoutinesPageClient } from "@/components/routines-page-client";
import { parseSessionToken } from "@/lib/auth/session";
import { DEFAULT_OG_IMAGE, absoluteUrl } from "@/lib/seo";

// Session-aware route: signed-in members get the routines app; signed-out
// visitors get the public SEO page about chore routines for kids.

const PAGE_TITLE = "Chore Routines for Kids: Daily, Weekly, and Monthly Habits That Stick";
const PAGE_DESCRIPTION =
  "Group chores into reusable routines — Morning Routine, Dinner Cleanup, Laundry Day — with step-by-step progress, completion bonuses, and Responsibility XP. Families using routines complete 31% more chores.";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: PAGE_TITLE },
  description: PAGE_DESCRIPTION,
  alternates: { canonical: "/routines" },
  openGraph: {
    type: "website",
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: absoluteUrl("/routines"),
    images: [{ url: DEFAULT_OG_IMAGE, width: 1200, height: 630, alt: "Family Chores" }],
  },
  twitter: {
    card: "summary_large_image",
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    images: [DEFAULT_OG_IMAGE],
  },
};

export default async function RoutinesRoute() {
  const cookieStore = await cookies();
  const sessionUser = parseSessionToken(cookieStore.get("session_user")?.value);

  if (sessionUser) {
    return (
      <main className="family-page">
        <RoutinesPageClient />
      </main>
    );
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(routinesFaqStructuredData()) }}
      />
      <MarketingRoutinesPage />
    </>
  );
}
