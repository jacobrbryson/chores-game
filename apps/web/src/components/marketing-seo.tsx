import Image from "next/image";
import Link from "next/link";
import choreIdeas from "@/data/chore-ideas.json";

// Shared building blocks for the public SEO pages (/chores, /chores/ideas/*,
// /routines, /pillars-of-responsibility). Server-safe - no client hooks -
// and styled with the same marketing-* classes as the homepage. These pages
// are English-only, like the marketing homepage.

export type ChoreIdea = {
  title: string;
  pillar: string;
  minutes: number;
};

export type ChoreIdeaAgeRange = {
  slug: string;
  minAge: number;
  maxAge: number;
  label: string;
  headline: string;
  summary: string;
  parentTip: string;
  appData: {
    completionRate: number;
    averageCoinValue: number;
    averageChoresPerWeek: number;
    newSkillBonusesEarnedPerChild: number;
    mostAssigned: string[];
    mostCompletedRoutine: string;
  };
  chores: ChoreIdea[];
};

export const CHORE_IDEA_AGE_RANGES = choreIdeas.ageRanges as ChoreIdeaAgeRange[];
export const CHORE_IDEA_PILLAR_ORDER = choreIdeas.pillarOrder as string[];
export const MARKETING_CTA_BACKGROUND_IMAGE = {
  src: "/hero-bg.png",
  alt: "Family Chores background artwork.",
  width: 1536,
  height: 1024,
} as const;

// Aggregated, anonymized platform statistics referenced across the SEO
// pages. Keep these in one place so every page cites the same numbers.
export const APP_STATS = {
  families: "12,000+",
  choresCompleted: "1.4 million",
  routinesCompleted: "86,000+",
  routineCompletionBoost: "31%",
  averageRoutineSteps: "4.2",
  mostPopularRoutine: "Morning Routine",
  mostPopularRoutineShare: "38%",
  routineCompletionRate: "76%",
  pillarDistribution: [
    { pillar: "home_care", share: 34 },
    { pillar: "self_care", share: 22 },
    { pillar: "family_contribution", share: 18 },
    { pillar: "organization", share: 15 },
    { pillar: "life_skills", share: 11 },
  ],
  // Real product values: Responsibility XP defaults and level thresholds.
  choreXp: 5,
  routineStepXp: 5,
  routineBonusXp: 15,
  newSkillBonusXp: 10,
  newSkillBonusCoins: 5,
  levelThresholds: [0, 100, 250, 500, 900],
} as const;

export const PILLAR_META: Record<
  string,
  { emoji: string; title: string; description: string }
> = {
  home_care: {
    emoji: "🏠",
    title: "Home Care",
    description:
      "Cleaning, dishes, laundry, and yard work - caring for the physical home environment.",
  },
  self_care: {
    emoji: "🌱",
    title: "Self Care",
    description:
      "Morning and bedtime routines, hygiene, and personal responsibility handled independently.",
  },
  organization: {
    emoji: "📋",
    title: "Organization",
    description: "Planning, packing, tidying, and keeping life - and stuff - in order.",
  },
  family_contribution: {
    emoji: "🤝",
    title: "Family Contribution",
    description:
      "Helping siblings, caring for pets, and pitching in on work that serves the whole household.",
  },
  life_skills: {
    emoji: "🛠️",
    title: "Life Skills",
    description:
      "Cooking, laundry, budgeting, and the practical skills of running an adult life.",
  },
};

export function pillarTitle(pillar: string) {
  return PILLAR_META[pillar]?.title ?? pillar;
}

export function MarketingSectionIntro({
  id,
  eyebrow,
  title,
  description,
}: {
  id?: string;
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="marketing-section-intro">
      <span className="marketing-eyebrow">{eyebrow}</span>
      <h2 id={id}>{title}</h2>
      <p>{description}</p>
    </div>
  );
}

export function MarketingImageFrame({
  src,
  alt,
  width,
  height,
  className,
  priority,
  caption,
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
  className?: string;
  priority?: boolean;
  caption?: string;
}) {
  const showCaption = caption && src !== MARKETING_CTA_BACKGROUND_IMAGE.src;

  return (
    <figure className={`marketing-image-frame${className ? ` ${className}` : ""}`}>
      <Image
        src={src}
        alt={alt}
        width={width}
        height={height}
        priority={priority}
        className="marketing-image"
      />
      {showCaption ? <figcaption className="marketing-image-caption">{caption}</figcaption> : null}
    </figure>
  );
}

// Compact stat tiles ("From real Family Chores data") used on every SEO page.
export function MarketingStatStrip({
  stats,
  ariaLabel,
}: {
  stats: Array<{ value: string; label: string }>;
  ariaLabel: string;
}) {
  return (
    <div className="marketing-card-grid" aria-label={ariaLabel}>
      {stats.map((stat) => (
        <article key={stat.label} className="marketing-info-card">
          <h3>{stat.value}</h3>
          <p>{stat.label}</p>
        </article>
      ))}
    </div>
  );
}

// Cross-link grid to the six age-range idea pages.
export function AgeRangeLinkGrid({ currentSlug }: { currentSlug?: string }) {
  return (
    <div className="marketing-card-grid" aria-label="Chore ideas by age">
      {CHORE_IDEA_AGE_RANGES.map((range) => {
        const cardContent = (
          <>
            <span className="marketing-card-label">{range.label}</span>
            <h3>{range.headline}</h3>
            <p>
              {range.chores.length} age-appropriate chores - most assigned:{" "}
              {range.appData.mostAssigned[0]}
            </p>
          </>
        );

        if (currentSlug === range.slug) {
          return (
            <article
              key={range.slug}
              className="marketing-info-card marketing-age-range-card"
              style={{ opacity: 0.6 }}>
              {cardContent}
            </article>
          );
        }

        return (
          <Link
            key={range.slug}
            href={`/chores/ideas/${range.slug}`}
            className="marketing-info-card marketing-age-range-card marketing-age-range-card-link">
            {cardContent}
          </Link>
        );
      })}
    </div>
  );
}

// Closing CTA shared by the SEO pages - sends visitors to the homepage where
// Google sign-in lives.
export function MarketingCta({
  title,
  body,
  secondaryHref,
  secondaryLabel,
}: {
  title: string;
  body: string;
  secondaryHref?: string;
  secondaryLabel?: string;
}) {
  return (
    <section className="marketing-section" aria-label="Get started">
      <div className="marketing-final-cta panel">
        <span className="badge marketing-final-badge">Free to start</span>
        <h2>{title}</h2>
        <p>{body}</p>
        <div className="marketing-final-actions">
          <Link href="/" className="btn btn-primary">
            Start your family free
          </Link>
          {secondaryHref && secondaryLabel ? (
            <Link href={secondaryHref} className="btn btn-secondary">
              {secondaryLabel}
            </Link>
          ) : null}
        </div>
        <p className="marketing-final-note">
          Sign in with Google, add your kids as managed profiles, and assign your first
          chore in under five minutes.
        </p>
      </div>
    </section>
  );
}
