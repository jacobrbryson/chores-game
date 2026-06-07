import type { MetadataRoute } from "next";
import { getChangeLogEntryGroups } from "@/lib/change-log";
import { SITE_URL as BASE_URL } from "@/lib/seo";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const changeLogEntries = getChangeLogEntryGroups().map((group) => ({
    url: `${BASE_URL}/change-log/${group.date}`,
    lastModified: new Date(`${group.date}T00:00:00Z`),
    changeFrequency: "never" as const,
    priority: 0.5,
  }));

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
      url: `${BASE_URL}/change-log`,
      changeFrequency: "weekly",
      priority: 0.6,
    },
    ...changeLogEntries,
  ];
}
