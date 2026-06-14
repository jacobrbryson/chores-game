import type { Metadata } from "next";
import { cookies } from "next/headers";
import {
  choresFaqStructuredData,
  MarketingChoresPage,
} from "@/components/marketing-chores-page";
import { parseSessionToken } from "@/lib/auth/session";
import { DEFAULT_OG_IMAGE, absoluteUrl } from "@/lib/seo";
import ChoresAppPage from "./chores-app-client";

// Session-aware route (same pattern as the homepage): signed-in members get
// the chores app; signed-out visitors get the public SEO page about chores
// for kids.

const PAGE_TITLE = "Chores for Kids: Age-by-Age Ideas, Rewards, and a System That Sticks";
const PAGE_DESCRIPTION =
  "How to run kids' chores that actually get done: age-appropriate chore ideas for ages 5–16, coin rewards, parent approval, repeat schedules, and Responsibility XP that turns chores into life skills.";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: PAGE_TITLE },
  description: PAGE_DESCRIPTION,
  alternates: { canonical: "/chores" },
  openGraph: {
    type: "website",
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    url: absoluteUrl("/chores"),
    images: [{ url: DEFAULT_OG_IMAGE, width: 1200, height: 630, alt: "Family Chores" }],
  },
  twitter: {
    card: "summary_large_image",
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    images: [DEFAULT_OG_IMAGE],
  },
};

export default async function ChoresRoute() {
  const cookieStore = await cookies();
  const sessionUser = parseSessionToken(cookieStore.get("session_user")?.value);

  if (sessionUser) {
    return <ChoresAppPage />;
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(choresFaqStructuredData()) }}
      />
      <MarketingChoresPage />
    </>
  );
}
