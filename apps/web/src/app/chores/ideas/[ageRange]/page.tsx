import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AgeRangeLinkGrid,
  CHORE_IDEA_AGE_RANGES,
  CHORE_IDEA_PILLAR_ORDER,
  MarketingCta,
  MarketingSectionIntro,
  MarketingStatStrip,
  PILLAR_META,
  pillarTitle,
  type ChoreIdeaAgeRange,
} from "@/components/marketing-seo";
import { absoluteUrl, DEFAULT_OG_IMAGE } from "@/lib/seo";

// Public, statically generated chore-idea guides: /chores/ideas/5-6 … 15-16.
// Content lives in src/data/chore-ideas.json (also intended for future
// in-app suggestion features), so the pages and the app never drift apart.

type PageProps = { params: Promise<{ ageRange: string }> };

function findRange(slug: string): ChoreIdeaAgeRange | undefined {
  return CHORE_IDEA_AGE_RANGES.find((range) => range.slug === slug);
}

export function generateStaticParams() {
  return CHORE_IDEA_AGE_RANGES.map((range) => ({ ageRange: range.slug }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { ageRange } = await params;
  const range = findRange(ageRange);
  if (!range) {
    return {};
  }
  const title = `Chores for ${range.minAge}–${range.maxAge} Year Olds: ${range.chores.length} Age-Appropriate Ideas`;
  const description = `${range.chores.length} chore ideas for kids ages ${range.minAge}–${range.maxAge}, organized by the life skill each one builds — with time estimates, parent tips, and what real families assign most.`;
  const canonical = `/chores/ideas/${range.slug}`;
  return {
    title: { absolute: title },
    description,
    alternates: { canonical },
    openGraph: {
      type: "article",
      title,
      description,
      url: absoluteUrl(canonical),
      images: [{ url: DEFAULT_OG_IMAGE, width: 1200, height: 630, alt: "Family Chores" }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [DEFAULT_OG_IMAGE],
    },
  };
}

function structuredData(range: ChoreIdeaAgeRange) {
  return [
    {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: `Chores for ${range.minAge}–${range.maxAge} year olds`,
      numberOfItems: range.chores.length,
      itemListElement: range.chores.map((chore, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: chore.title,
      })),
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: [
        {
          "@type": "Question",
          name: `What chores can a ${range.minAge}–${range.maxAge} year old do?`,
          acceptedAnswer: { "@type": "Answer", text: range.summary },
        },
        {
          "@type": "Question",
          name: `How many chores should a ${range.minAge}–${range.maxAge} year old have?`,
          acceptedAnswer: {
            "@type": "Answer",
            text: `Across Family Chores, kids ages ${range.minAge}–${range.maxAge} average ${range.appData.averageChoresPerWeek} chores per week with a ${Math.round(range.appData.completionRate * 100)}% completion rate. Start below that and add as completion stays high.`,
          },
        },
      ],
    },
  ];
}

export default async function ChoreIdeasPage({ params }: PageProps) {
  const { ageRange } = await params;
  const range = findRange(ageRange);
  if (!range) {
    notFound();
  }

  const choresByPillar = CHORE_IDEA_PILLAR_ORDER.map((pillar) => ({
    pillar,
    chores: range.chores.filter((chore) => chore.pillar === pillar),
  })).filter((group) => group.chores.length > 0);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData(range)) }}
      />
      <main className="marketing-home">
        <section className="marketing-hero panel" aria-labelledby="ideas-page-title">
          <div className="hero-copy marketing-hero-copy">
            <span className="marketing-hero-kicker">
              Chore ideas · {range.label}
            </span>
            <h1 id="ideas-page-title">
              {range.chores.length} chores for {range.minAge}–{range.maxAge} year olds —{" "}
              {range.headline.toLowerCase()}.
            </h1>
            <p>{range.summary}</p>
            <div className="marketing-hero-actions">
              <Link href="/" className="btn btn-primary">
                Assign these in Family Chores
              </Link>
              <Link href="#chore-list" className="btn btn-secondary">
                Jump to the chore list
              </Link>
            </div>
            <p className="marketing-hero-actions-note">
              <strong>Parent tip:</strong> {range.parentTip}
            </p>
          </div>
        </section>

        <section className="marketing-section" aria-labelledby="ideas-data-title">
          <MarketingSectionIntro
            id="ideas-data-title"
            eyebrow="From real Family Chores data"
            title={`What families actually assign at ${range.label.toLowerCase()}.`}
            description="Aggregated, anonymized platform numbers for this age range — a realistic baseline, not a Pinterest fantasy."
          />
          <MarketingStatStrip
            ariaLabel={`Statistics for ${range.label}`}
            stats={[
              {
                value: `${Math.round(range.appData.completionRate * 100)}%`,
                label: "of assigned chores get completed at this age",
              },
              {
                value: String(range.appData.averageChoresPerWeek),
                label: "chores per week on the average chart",
              },
              {
                value: `${range.appData.averageCoinValue} coins`,
                label: "average payout per chore",
              },
              {
                value: String(range.appData.newSkillBonusesEarnedPerChild),
                label: "New Skill Bonuses earned per child in the first year",
              },
            ]}
          />
          <div className="marketing-card-grid">
            <article className="marketing-info-card">
              <span className="marketing-card-label">Most assigned</span>
              <h3>The top three at this age</h3>
              <ul className="marketing-checklist">
                {range.appData.mostAssigned.map((title) => (
                  <li key={title}>{title}</li>
                ))}
              </ul>
            </article>
            <article className="marketing-info-card">
              <span className="marketing-card-label">Most completed routine</span>
              <h3>{range.appData.mostCompletedRoutine}</h3>
              <p>
                The routine this age group finishes most often. See how chores chain into
                habits on the <Link href="/routines">routines page</Link>.
              </p>
            </article>
          </div>
        </section>

        <section className="marketing-section" id="chore-list" aria-labelledby="chore-list-title">
          <MarketingSectionIntro
            id="chore-list-title"
            eyebrow="The list"
            title={`Chore ideas for ages ${range.minAge}–${range.maxAge}, by the skill they build.`}
            description="Every chore is tagged with one of the five Pillars of Responsibility, so you can balance the chart instead of accidentally raising a vacuuming specialist."
          />
          {choresByPillar.map((group) => (
            <div key={group.pillar} className="marketing-section-intro" style={{ marginTop: "1.5rem" }}>
              <h3>
                {PILLAR_META[group.pillar].emoji} {pillarTitle(group.pillar)}{" "}
                <span className="small">({group.chores.length} chores)</span>
              </h3>
              <p className="small">{PILLAR_META[group.pillar].description}</p>
              <ul className="marketing-checklist">
                {group.chores.map((chore) => (
                  <li key={chore.title}>
                    {chore.title} <span className="small">· ~{chore.minutes} min</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="marketing-hero-actions-note">
            Inside Family Chores, each of these becomes a real chore with coins, optional
            parent approval, a repeat schedule, and Responsibility XP toward its pillar —
            learn how the system works on the{" "}
            <Link href="/pillars-of-responsibility">Pillars of Responsibility</Link> page.
          </p>
        </section>

        <section className="marketing-section" aria-labelledby="other-ages-title">
          <MarketingSectionIntro
            id="other-ages-title"
            eyebrow="Other ages"
            title="Chore ideas for every age, 5 to 16."
            description="Kids grow; the chart should too. Each guide shifts the mix toward more independence and bigger skills."
          />
          <AgeRangeLinkGrid currentSlug={range.slug} />
        </section>

        <MarketingCta
          title={`Put these chores to work for your ${range.minAge}–${range.maxAge} year old.`}
          body="Create your family free, add these chores in minutes, and let coins, routines, and Responsibility XP handle the daily motivation."
          secondaryHref="/chores"
          secondaryLabel="Back to the chores guide"
        />
      </main>
    </>
  );
}
