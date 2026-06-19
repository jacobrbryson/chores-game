import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // App and private surfaces that should never be indexed. Public SEO
        // pages (/, /change-log, /privacy-policy, /terms-of-service, /docs/api,
        // /chores, /chores/ideas/*, /chores/[slug], /routines,
        // /pillars-of-responsibility, /rewards/[slug], /resources/[slug])
        // stay crawlable. /chores and /routines are session-aware: signed-out
        // visitors get public marketing pages.
        disallow: [
          "/api/",
          "/achievements/",
          "/community/",
          "/docs/",
          "/family/",
          "/notifications/",
          "/onboarding/",
          "/profile/",
          "/quests/",
          "/resources/",
          "/rewards/",
          "/store/",
          "/support/",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
