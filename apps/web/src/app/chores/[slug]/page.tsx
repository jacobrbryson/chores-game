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
  return {
    title: content.seoTitle || content.title,
    description: content.seoDescription || content.shortDescription,
    alternates: { canonical: content.canonicalPath },
    openGraph: {
      title: content.seoTitle || content.title,
      description: content.seoDescription || content.shortDescription,
      images: content.ogImage || content.image ? [content.ogImage || content.image] : undefined,
    },
  };
}

export default async function PublicChorePage({ params }: PageProps) {
  const { slug } = await params;
  const content = await loadChore(slug);
  if (!content) notFound();
  return <PublicContentPage content={content} />;
}
