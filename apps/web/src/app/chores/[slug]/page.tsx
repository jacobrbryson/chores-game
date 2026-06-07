import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicContentPage } from "@/components/public-content-page";
import { getPublishedContentBySlug } from "@/lib/public-content/service";
import type { PublicContentPublicRecord } from "@/lib/public-content/types";

type PageProps = { params: Promise<{ slug: string }> };

async function loadChore(slug: string): Promise<PublicContentPublicRecord | null> {
  try {
    return await getPublishedContentBySlug(slug, "chore");
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown";
    console.warn("[PUBLIC_CHORE_LOOKUP_SKIPPED]", reason.slice(0, 180));
    return null;
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const content = await loadChore(slug);
  if (!content) return {};
  const title = content.seoTitle || content.title;
  const description = content.seoDescription || content.shortDescription;
  const image = content.ogImage || content.image;
  return {
    title,
    description,
    alternates: { canonical: content.canonicalPath },
    openGraph: {
      type: "article",
      title,
      description,
      url: content.canonicalPath,
      images: image ? [image] : undefined,
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title,
      description,
      images: image ? [image] : undefined,
    },
  };
}

export default async function PublicChorePage({ params }: PageProps) {
  const { slug } = await params;
  const content = await loadChore(slug);
  if (!content) notFound();
  return <PublicContentPage content={content} />;
}
