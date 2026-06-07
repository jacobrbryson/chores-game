import Link from "next/link";
import { createTranslator, DEFAULT_LOCALE, type AppLocale } from "@packages/locales";
import type { PublicContentPublicRecord } from "@/lib/public-content/types";
import { absoluteUrl } from "@/lib/seo";

function formatDate(value: string, locale: AppLocale) {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString(locale);
}

export function PublicContentPage({ content }: { content: PublicContentPublicRecord }) {
  const t = createTranslator({ locale: content.locale || DEFAULT_LOCALE });
  const date = formatDate(content.lastReviewedAt || content.publishedAt, content.locale || DEFAULT_LOCALE);
  const paragraphs = content.body.split(/\n{2,}/).map((entry) => entry.trim()).filter(Boolean);

  const sharedJsonLd = {
    "@context": "https://schema.org",
    name: content.title,
    description: content.shortDescription,
    url: absoluteUrl(content.canonicalPath),
    ...(content.image ? { image: absoluteUrl(content.image) } : {}),
    datePublished: content.publishedAt,
  };

  const jsonLd =
    content.type === "reward"
      ? {
          ...sharedJsonLd,
          "@type": "CreativeWork",
        }
      : {
          ...sharedJsonLd,
          "@type": content.type === "chore" ? "HowTo" : "Article",
          dateModified: content.lastReviewedAt || content.publishedAt,
          ...(content.type === "chore" && content.estimatedMinutes
            ? { totalTime: `PT${content.estimatedMinutes}M` }
            : {}),
        };

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
        <div className="mb-4 flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <span>{content.type.replace("_", " ")}</span>
          {content.category ? <span>{content.category}</span> : null}
          {date ? <span>{t("publicContent.lastReviewed", { date })}</span> : null}
        </div>
        <h1 className="text-3xl font-bold text-slate-950 sm:text-4xl">{content.title}</h1>
        <p className="mt-3 max-w-3xl text-base leading-7 text-slate-700">{content.shortDescription}</p>
        {content.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={content.image} alt="" className="mt-6 aspect-[16/9] w-full rounded-lg object-cover" />
        ) : null}
        <div className="prose prose-slate mt-6 max-w-none">
          {paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
        <dl className="mt-6 grid gap-3 border-t border-slate-200 pt-5 text-sm sm:grid-cols-3">
          {content.ageRange ? (
            <div>
              <dt className="font-semibold text-slate-900">{t("publicContent.ageRange")}</dt>
              <dd className="text-slate-600">{content.ageRange}</dd>
            </div>
          ) : null}
          {content.difficulty ? (
            <div>
              <dt className="font-semibold text-slate-900">{t("publicContent.difficulty")}</dt>
              <dd className="text-slate-600">{content.difficulty}</dd>
            </div>
          ) : null}
          {content.estimatedMinutes ? (
            <div>
              <dt className="font-semibold text-slate-900">{t("publicContent.estimatedMinutes")}</dt>
              <dd className="text-slate-600">{content.estimatedMinutes}</dd>
            </div>
          ) : null}
        </dl>
      </article>
      <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
        <h2 className="text-lg font-bold text-emerald-950">{t("publicContent.ctaTitle")}</h2>
        <p className="mt-1 text-sm text-emerald-900">{t("publicContent.ctaBody")}</p>
        <Link href="/" className="btn btn-primary mt-4 inline-flex">
          {t("publicContent.ctaAction")}
        </Link>
      </section>
    </main>
  );
}
