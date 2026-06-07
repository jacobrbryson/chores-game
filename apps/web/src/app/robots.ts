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
        // /chores/[slug], /rewards/[slug], /resources/[slug]) stay crawlable.
        disallow: [
          "/api/",
          "/family/",
          "/support/",
          "/onboarding/",
          "/profile/",
          "/notifications/",
          "/my-requests/",
          "/quests/",
          "/achievements/",
          "/community/",
          "/store/",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
