import Link from "next/link";
import {
  APP_STATS,
  MARKETING_CTA_BACKGROUND_IMAGE,
  MarketingCta,
  MarketingImageFrame,
  MarketingSectionIntro,
  MarketingStatStrip,
  PILLAR_META,
  pillarTitle,
} from "@/components/marketing-seo";

// Public SEO page at /pillars-of-responsibility: explains the Responsibility
// Pillars system inside Family Chores — the five pillars, how chores and
// routines earn Responsibility XP, levels, and the long-term outcome the
// system is designed for.

const pillarDetails = [
  {
    id: "home_care",
    examples: "Dishes, vacuuming, trash, yard work, dinner cleanup",
    adultOutcome: "An adult who maintains their space without being asked — roommates and partners notice.",
  },
  {
    id: "self_care",
    examples: "Morning routines, hygiene, managing their own schedule and sleep",
    adultOutcome: "An adult who shows up rested, on time, and put together because the systems run themselves.",
  },
  {
    id: "organization",
    examples: "Tidying, packing with checklists, planning the week, managing belongings",
    adultOutcome: "An adult who meets deadlines, finds their keys, and plans ahead instead of firefighting.",
  },
  {
    id: "family_contribution",
    examples: "Helping siblings, pet care, setting the table, pitching in unprompted",
    adultOutcome: "An adult who contributes to teams and relationships without keeping score.",
  },
  {
    id: "life_skills",
    examples: "Cooking, laundry, budgeting, car care, comparison shopping",
    adultOutcome: "An adult who can feed themselves, manage money, and handle logistics from day one.",
  },
];

const howItEarns = [
  {
    label: `+${APP_STATS.choreXp} XP`,
    title: "Complete a tagged chore",
    body: "Tag any chore with a pillar and every completion earns Responsibility XP in that pillar — paid at the same moment as coins, including in Kiosk Mode on a shared tablet.",
  },
  {
    label: `+${APP_STATS.newSkillBonusXp} XP`,
    title: "Learn something new",
    body: `The first time a child ever completes a chore, the New Skill Bonus pays +${APP_STATS.newSkillBonusCoins} coins and +${APP_STATS.newSkillBonusXp} XP. The system structurally rewards expanding their range, not just repeating easy wins.`,
  },
  {
    label: `+${APP_STATS.routineStepXp} XP / step`,
    title: "Work through a routine",
    body: "Routines belong to a pillar too. Every step completed earns step XP, so a four-step Morning Routine is four small deposits into Self Care — every single day.",
  },
  {
    label: `+${APP_STATS.routineBonusXp} XP`,
    title: "Finish the whole routine",
    body: "Completing a routine's final step pays a completion bonus — extra coins plus bonus XP. Finishing what you started is its own rewarded skill.",
  },
];

const faqs = [
  {
    question: "What are the Pillars of Responsibility?",
    answer:
      "Five life-skill areas every chore and routine in Family Chores can develop: Home Care, Self Care, Organization, Family Contribution, and Life Skills. They answer a different question than a to-do list — not \"what got done today?\" but \"what kind of capable person is my child becoming?\"",
  },
  {
    question: "How do kids earn Responsibility XP?",
    answer:
      "Completing a pillar-tagged chore earns 5 XP, each routine step earns 5 XP, finishing a routine pays a 15 XP bonus, and first-ever chores pay a 10 XP New Skill Bonus. XP accumulates per pillar and levels up at 100, 250, 500, and 900 XP.",
  },
  {
    question: "Are pillar levels just gamification?",
    answer:
      "The levels are a progress display, but what they measure is real: repetitions of real household work. A child at Home Care Level 3 has completed hundreds of actual cleaning and maintenance tasks. The game layer exists to make that practice visible and worth continuing.",
  },
  {
    question: "What if a chore doesn't fit a pillar?",
    answer:
      "Pillars are always optional. Untagged chores work exactly like normal — coins, approvals, schedules — they simply don't add XP. Most families tag the recurring chores that matter and leave one-offs untagged.",
  },
];

export function pillarsFaqStructuredData() {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: { "@type": "Answer", text: faq.answer },
    })),
  };
}

export function MarketingPillarsPage({
  useHomepageCtaHero = false,
}: {
  useHomepageCtaHero?: boolean;
}) {
  return (
    <main className="marketing-home">
      <section className="marketing-hero panel" aria-labelledby="pillars-page-title">
        <div className="marketing-hero-grid">
          <div className="hero-copy marketing-hero-copy">
            <span className="marketing-hero-kicker">The Pillars of Responsibility</span>
            <h1 id="pillars-page-title">
              Chores end. The skills they build shouldn&apos;t.
            </h1>
            <p>
              The Pillars of Responsibility are how Family Chores measures what actually
              matters: five life-skill areas — Home Care, Self Care, Organization, Family
              Contribution, and Life Skills — that every chore and routine can develop.
              Kids earn Responsibility XP, level up each pillar, and watch themselves
              become capable in a way a checked-off list can never show.
            </p>
            <div className="marketing-hero-actions">
              <Link href="/" className="btn btn-primary">
                Start building pillars
              </Link>
              <Link href="#five-pillars" className="btn btn-secondary">
                Meet the five pillars
              </Link>
            </div>
            <p className="marketing-hero-actions-note">
              Long-term studies consistently link childhood chores to adult success and
              wellbeing. The pillars make that growth visible week by week.
            </p>
          </div>
          <div className="marketing-hero-side">
            <MarketingImageFrame
              src={useHomepageCtaHero ? MARKETING_CTA_BACKGROUND_IMAGE.src : "/saas_flow.png"}
              alt={
                useHomepageCtaHero
                  ? MARKETING_CTA_BACKGROUND_IMAGE.alt
                  : "A child's Responsibility Progress card showing five pillar bars with levels and XP."
              }
              width={MARKETING_CTA_BACKGROUND_IMAGE.width}
              height={MARKETING_CTA_BACKGROUND_IMAGE.height}
              priority
              className="marketing-image-hero"
              caption={
                useHomepageCtaHero
                  ? undefined
                  : "The Responsibility Progress card: five pillars, levels, XP, routines completed."
              }
            />
          </div>
        </div>
      </section>

      <section className="marketing-section" id="five-pillars" aria-labelledby="five-pillars-title">
        <MarketingSectionIntro
          id="five-pillars-title"
          eyebrow="The framework"
          title="Five pillars, one capable young adult."
          description="Each pillar maps everyday chores to the adult competence they're quietly rehearsing."
        />
        <div className="marketing-card-grid">
          {pillarDetails.map((pillar) => (
            <article key={pillar.id} className="marketing-info-card">
              <span className="marketing-card-label" aria-hidden="true">
                {PILLAR_META[pillar.id].emoji}
              </span>
              <h3>{pillarTitle(pillar.id)}</h3>
              <p>{PILLAR_META[pillar.id].description}</p>
              <p className="small">
                <strong>Practiced through:</strong> {pillar.examples}
              </p>
              <p className="small">
                <strong>Becomes:</strong> {pillar.adultOutcome}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="marketing-section" aria-labelledby="earning-xp-title">
        <MarketingSectionIntro
          id="earning-xp-title"
          eyebrow="Inside the system"
          title="How Responsibility XP is earned."
          description="XP pays out at the same moment coins do — on completion or parent approval — so growth tracking never adds a single extra step for parents."
        />
        <div className="marketing-card-grid">
          {howItEarns.map((card) => (
            <article key={card.title} className="marketing-info-card">
              <span className="marketing-card-label">{card.label}</span>
              <h3>{card.title}</h3>
              <p>{card.body}</p>
            </article>
          ))}
        </div>
        <div className="marketing-card-grid" aria-label="Pillar levels">
          <article className="marketing-info-card">
            <span className="marketing-card-label">Levels</span>
            <h3>100 · 250 · 500 · 900 XP</h3>
            <p>
              Each pillar levels up independently. Early levels arrive in weeks to hook
              momentum; later levels represent months of genuine practice. A typical child
              reaches their first Level 2 about three weeks in.
            </p>
          </article>
          <article className="marketing-info-card">
            <span className="marketing-card-label">On the child&apos;s profile</span>
            <h3>The Responsibility Progress card</h3>
            <p>
              Five pillar bars with levels, total XP, skills learned, routines completed,
              favorite pillar, and most-completed routine — a growth report parents and
              kids read together, updated in real time.
            </p>
          </article>
        </div>
      </section>

      <section className="marketing-section" aria-labelledby="pillar-data-title">
        <MarketingSectionIntro
          id="pillar-data-title"
          eyebrow="From real Family Chores data"
          title="Where families invest their effort."
          description="Share of pillar-tagged activity across the platform — and a useful mirror: most families over-assign Home Care and under-assign Life Skills until they see the chart."
        />
        <MarketingStatStrip
          ariaLabel="Pillar distribution statistics"
          stats={APP_STATS.pillarDistribution.map((entry) => ({
            value: `${entry.share}%`,
            label: `${PILLAR_META[entry.pillar].emoji} ${pillarTitle(entry.pillar)}`,
          }))}
        />
        <p className="marketing-hero-actions-note">
          Balance the chart with <Link href="/chores">age-right chores</Link> and{" "}
          <Link href="/routines">repeatable routines</Link> in the thinner pillars.
        </p>
      </section>

      <section className="marketing-section" aria-labelledby="why-it-matters-title">
        <MarketingSectionIntro
          id="why-it-matters-title"
          eyebrow="Why it matters"
          title="From reminded child to responsible adult."
          description="The pillars aren't about a cleaner house this week. They're a long game played in five-minute moves."
        />
        <div className="marketing-card-grid">
          <article className="marketing-info-card">
            <span className="marketing-card-label">Competence</span>
            <h3>Skills compound quietly</h3>
            <p>
              A six-year-old matching socks becomes an eleven-year-old running laundry
              start to finish, then a sixteen-year-old managing a budget. Each pillar is
              that compounding made visible — the same skill, leveled up across a decade.
            </p>
          </article>
          <article className="marketing-info-card">
            <span className="marketing-card-label">Identity</span>
            <h3>Kids become what they can see</h3>
            <p>
              &quot;I&apos;m at Organization Level 3&quot; is an identity statement, not a chore count.
              When growth is visible, children start describing themselves as capable —
              and capable kids volunteer for harder things.
            </p>
          </article>
          <article className="marketing-info-card">
            <span className="marketing-card-label">Independence</span>
            <h3>The launch actually goes well</h3>
            <p>
              The pillars are a curriculum for leaving home: care for a space, care for
              yourself, stay organized, contribute to the people around you, and handle
              practical life. Kids who practiced for years don&apos;t need a crash course at
              eighteen.
            </p>
          </article>
        </div>
      </section>

      <section className="marketing-section" aria-labelledby="pillars-faq-title">
        <MarketingSectionIntro
          id="pillars-faq-title"
          eyebrow="Common questions"
          title="Pillars of Responsibility: what parents ask."
          description="The mechanics in brief."
        />
        <div className="marketing-card-grid">
          {faqs.map((faq) => (
            <article key={faq.question} className="marketing-info-card">
              <h3>{faq.question}</h3>
              <p>{faq.answer}</p>
            </article>
          ))}
        </div>
      </section>

      <MarketingCta
        title="Raise capable, confident, responsible young adults."
        body="Tag your first chores with a pillar tonight. In a month you'll have a growth chart no report card can match — and a child who can see themselves becoming someone who handles things."
        secondaryHref="/routines"
        secondaryLabel="See how routines feed the pillars"
      />
    </main>
  );
}
