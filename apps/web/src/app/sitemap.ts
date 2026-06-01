import type { MetadataRoute } from "next";
import { getChangeLogEntryGroups } from "@/lib/change-log";

const BASE_URL = "https://family-chores.app";

export default function sitemap(): MetadataRoute.Sitemap {
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
  ];
}
