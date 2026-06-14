import type { Metadata } from "next";
import { cookies } from "next/headers";
import {
  MarketingPillarsPage,
  pillarsFaqStructuredData,
} from "@/components/marketing-pillars-page";
import { parseSessionToken } from "@/lib/auth/session";
import { absoluteUrl, DEFAULT_OG_IMAGE } from "@/lib/seo";

// Public SEO page describing the Responsibility Pillars system. Always
// public — signed-in members may land here from marketing links too.

const PAGE_TITLE =
  "Pillars of Responsibility: How Chores Become Life Skills in Family Chores";
const PAGE_DESCRIPTION =
  "Inside the Responsibility Pillars system: five life-skill areas — Home Care, Self Care, Organization, Family Contribution, Life Skills — with Responsibility XP, levels, and routines that turn everyday chores into capable, confident young adults.";

export const metadata: Metadata = {
  title: { absolute: PAGE_TITLE },
  description: PAGE_DESCRIPTION,
  alternates: { canonical: "/pillars-of-responsibility" },
  openGraph: {
    type: "website",
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: absoluteUrl("/pillars-of-responsibility"),
    images: [{ url: DEFAULT_OG_IMAGE, width: 1200, height: 630, alt: "Family Chores" }],
  },
  twitter: {
    card: "summary_large_image",
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    images: [DEFAULT_OG_IMAGE],
  },
};

export default async function PillarsOfResponsibilityRoute() {
  const cookieStore = await cookies();
  const sessionUser = parseSessionToken(cookieStore.get("session_user")?.value);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(pillarsFaqStructuredData()) }}
      />
      <MarketingPillarsPage useHomepageCtaHero={!sessionUser} />
    </>
  );
}
