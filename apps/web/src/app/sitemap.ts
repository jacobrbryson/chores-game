import type { MetadataRoute } from "next";
import { getChangeLogEntryGroups } from "@/lib/change-log";
import { listPublishedPublicContent } from "@/lib/public-content/service";

const BASE_URL = "https://family-chores.app";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const changeLogEntries = getChangeLogEntryGroups().map((group) => ({
    url: `${BASE_URL}/change-log/${group.date}`,
    lastModified: new Date(`${group.date}T00:00:00Z`),
    changeFrequency: "never" as const,
    priority: 0.5,
  }));

  let publicContentEntries: MetadataRoute.Sitemap = [];
  try {
    const { content } = await listPublishedPublicContent({ limit: 100 });
    publicContentEntries = content
      .filter((entry) => ["chore", "reward", "guide"].includes(entry.type))
      .map((entry) => ({
        url: `${BASE_URL}${entry.canonicalPath}`,
        lastModified: new Date(entry.lastReviewedAt || entry.publishedAt || Date.now()),
        changeFrequency: "monthly" as const,
        priority: entry.type === "guide" ? 0.6 : 0.5,
      }));
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown";
    console.warn("[SITEMAP_PUBLIC_CONTENT_SKIPPED]", reason.slice(0, 180));
  }

  return [
    {
      url: `${BASE_URL}/`,
      changeFrequency: "weekly",
      priority: 1.0,
    },
    {
      url: `${BASE_URL}/privacy-policy`,
      changeFrequency: "monthly",
      priority: 0.4,
    },
    {
      url: `${BASE_URL}/terms-of-service`,
      changeFrequency: "monthly",
      priority: 0.4,
    },
    {
      url: `${BASE_URL}/docs/api`,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${BASE_URL}/change-log`,
      changeFrequency: "weekly",
      priority: 0.6,
    },
    ...changeLogEntries,
    ...publicContentEntries,
  ];
}
