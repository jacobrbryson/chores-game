import Link from "next/link";
import {
  AgeRangeLinkGrid,
  APP_STATS,
  MarketingCta,
  MarketingImageFrame,
  MarketingSectionIntro,
} from "@/components/marketing-seo";

// Public SEO page served at /chores for signed-out visitors. Focus: chores
// for kids — how to choose them, how Family Chores runs them, and a gateway
// into the age-by-age idea guides. Signed-in users see the chores app at the
// same URL instead.

const choreWorkflowCards = [
  {
    label: "Assign",
    title: "Every chore has one clear owner",
    body: "Assign chores to one child, a group, or the whole family. Each chore carries its own coin value, due date, and an optional repeat schedule — daily, weekly, monthly, or custom.",
  },
  {
    label: "Complete",
    title: "Kids mark work done themselves",
    body: "Children check off chores from their own dashboard, a shared-tablet Kiosk Mode, or right after school. Coins pay out instantly for trusted chores.",
  },
  {
    label: "Approve",
    title: "Parent review where it matters",
    body: "Flag any chore as approval-required and it waits for a parent's sign-off before coins move. Adjust the payout at approval time if the job was half done — or above and beyond.",
  },
  {
    label: "Grow",
    title: "Chores feed long-term growth",
    body: "Tag chores with a Responsibility Pillar and every completion earns Responsibility XP alongside coins — visible progress toward real life skills, not just a cleared list.",
  },
];

const motivationCards = [
  {
    label: "New Skill Bonus",
    title: `+${APP_STATS.newSkillBonusCoins} coins for every first`,
    body: `The first time a child ever completes a chore, Family Chores pays an automatic +${APP_STATS.newSkillBonusCoins} coin New Skill Bonus and +${APP_STATS.newSkillBonusXp} Responsibility XP. Trying new things is rewarded by design — it's how chore lists turn into skill lists.`,
  },
  {
    label: "Coins that mean something",
    title: "An economy parents control",
    body: "Coins buy avatar gear, themes, quest content, and custom family awards that parents define — movie night, a sleepover, a later bedtime. The reward is whatever actually motivates your child.",
  },
  {
    label: "Visible momentum",
    title: "A live family feed",
    body: "Completions, approvals, and milestones appear in a realtime family activity feed, so effort gets noticed the moment it happens — no end-of-week accounting required.",
  },
];

const reasonableCards = [
  {
    label: "Start small",
    title: "Match the job to what they can already do",
    body: "A good first chore is one your child can finish without you hovering. Short, visible jobs — making a bed, feeding a pet, clearing their plate — build the habit of finishing before you add harder work.",
  },
  {
    label: "Add as they grow",
    title: "Hand over a little more each season",
    body: "When a chore stops needing reminders, it's ready to level up. Move from helper tasks to owning a full job with a quality standard, then to running a whole domain like laundry or cooking by the teen years.",
  },
  {
    label: "Make effort fit reward",
    title: "Pay for the work, not the calendar",
    body: "Whatever you pay, keep it proportional to effort. Family Chores lets you set a coin value per chore and adjust it at approval time, so a half-done job and an above-and-beyond one don't earn the same.",
  },
  {
    label: "Let routines carry it",
    title: "Bundle chores into repeatable habits",
    body: "The hardest part of any chore chart is remembering it. Group related chores into a routine with its own schedule, and the structure does the reminding instead of you.",
  },
];

const faqs = [
  {
    question: "What chores should kids do at each age?",
    answer:
      "Five and six year olds do best with short, visible helper jobs like making the bed or feeding a pet. By 9–10 kids can own full jobs with quality standards, and teens can run whole domains like laundry, cooking, and car care. Our age guides list 28–31 specific chores per age range, each tagged with the life skill it builds.",
  },
  {
    question: "Should kids get paid for chores?",
    answer:
      "Families differ, and Family Chores supports both styles. Coins can pay out for every chore, only for above-and-beyond work, or be set to zero with rewards tied to routines and milestones instead. A common approach is to pay a little more as the work gets harder — you set the coin value per chore, so the choice stays yours.",
  },
  {
    question: "How do I stop nagging my kids about chores?",
    answer:
      "Three things consistently help: a visible list kids check themselves, rewards that pay out without a parent remembering, and routines that bundle chores into one repeatable habit. When the structure does the reminding, you don't have to.",
  },
  {
    question: "Do chores actually help child development?",
    answer:
      "Decades of research link childhood chores with adult success, work ethic, and wellbeing. Chores teach competence, contribution, and follow-through — which is why Family Chores maps every chore to one of five Responsibility Pillars and tracks that growth over time.",
  },
];

export function choresFaqStructuredData() {
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

export function MarketingChoresPage() {
  return (
    <main className="marketing-home">
      <section className="marketing-hero panel" aria-labelledby="chores-page-title">
        <div className="marketing-hero-grid">
          <div className="marketing-hero-copy marketing-hero-copy-plain">
            <span className="marketing-hero-kicker">Chores for kids, done right</span>
            <h1 id="chores-page-title">
              A chore system kids actually follow — and grow from.
            </h1>
            <p>
              Family Chores turns household jobs into a clear, motivating system: one owner
              per chore, coins and rewards kids care about, parent approval only where you
              want it, and Responsibility XP that turns every completed job into measurable
              life-skill growth.
            </p>
            <div className="marketing-hero-actions">
              <Link href="/" className="btn btn-primary">
                Start your family free
              </Link>
              <Link href="#chore-ideas-by-age" className="btn btn-secondary marketing-chores-secondary-cta">
                Browse chore ideas by age
              </Link>
            </div>
          </div>
          <div className="marketing-hero-side">
            <MarketingImageFrame
              src="/chores-workflow.png"
              alt="Assign, complete, approve, and grow — the Family Chores workflow."
              width={1536}
              height={1024}
              priority
              className="marketing-image-hero"
            />
          </div>
        </div>
      </section>

      <section className="marketing-section" aria-labelledby="chore-workflow-title">
        <MarketingSectionIntro
          id="chore-workflow-title"
          eyebrow="How it works"
          title="Assign, complete, approve, grow."
          description="Four steps, repeated until they become habits. Parents set the rules once; the system carries them every day after that."
        />
        <div className="marketing-card-grid">
          {choreWorkflowCards.map((card) => (
            <article key={card.title} className="marketing-info-card">
              <span className="marketing-card-label">{card.label}</span>
              <h3>{card.title}</h3>
              <p>{card.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="marketing-section" aria-labelledby="chores-data-title">
        <MarketingSectionIntro
          id="chores-data-title"
          eyebrow="Deciding what's reasonable"
          title="How to pick chores that actually fit your kid."
          description="There's no universal chore quota. These are the principles that keep a chart fair as your child grows — start where they are, and let the work scale with them."
        />
        <div className="marketing-card-grid">
          {reasonableCards.map((card) => (
            <article key={card.title} className="marketing-info-card">
              <span className="marketing-card-label">{card.label}</span>
              <h3>{card.title}</h3>
              <p>{card.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section
        className="marketing-section"
        id="chore-ideas-by-age"
        aria-labelledby="chore-ideas-title">
        <MarketingSectionIntro
          id="chore-ideas-title"
          eyebrow="Chore ideas by age"
          title="The right chores for 5 to 16 year olds."
          description="Six age-by-age guides, each with 28–31 specific chores tagged by the Responsibility Pillar it develops, time estimates, and what families on the platform actually assign most."
        />
        <AgeRangeLinkGrid />
      </section>

      <section className="marketing-section" aria-labelledby="chore-motivation-title">
        <MarketingSectionIntro
          id="chore-motivation-title"
          eyebrow="Motivation built in"
          title="Why kids keep going after week one."
          description="Most chore charts die in a fortnight. These are the mechanics that keep this one alive."
        />
        <div className="marketing-card-grid">
          {motivationCards.map((card) => (
            <article key={card.title} className="marketing-info-card">
              <span className="marketing-card-label">{card.label}</span>
              <h3>{card.title}</h3>
              <p>{card.body}</p>
            </article>
          ))}
        </div>
        <p className="marketing-hero-actions-note">
          Ready for the next level? Group chores into{" "}
          <Link href="/routines">reusable routines</Link> that build{" "}
          <Link href="/pillars-of-responsibility">Pillars of Responsibility</Link>.
        </p>
      </section>

      <section className="marketing-section" aria-labelledby="chores-faq-title">
        <MarketingSectionIntro
          id="chores-faq-title"
          eyebrow="Common questions"
          title="Chores for kids: what parents ask us."
          description="Short answers here — the age guides go deeper on every range."
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
        title="Put your family's chores on autopilot."
        body="Set up chores with coins, approvals, and repeat schedules once — then watch completions, rewards, and Responsibility XP take over the daily follow-up."
        secondaryHref="/chores/ideas/5-6"
        secondaryLabel="See chores for ages 5–6"
      />
    </main>
  );
}
