import Link from "next/link";
import routinesWorkflowImage from "../../public/routines-workflow.png";
import {
  APP_STATS,
  MarketingCta,
  MarketingImageFrame,
  MarketingSectionIntro,
  MarketingStatStrip,
} from "@/components/marketing-seo";

// Public SEO page served at /routines for signed-out visitors. Focus: turning
// individual chores into daily/weekly/monthly routines, and how routines feed
// the Pillars of Responsibility. Signed-in users see the routines app at the
// same URL instead.

const exampleRoutines = [
  {
    name: "Morning Routine",
    cadence: "Daily",
    pillar: "🌱 Self Care",
    steps: ["Make the bed", "Get dressed", "Brush teeth", "Pack your backpack"],
    note: `The most popular routine on the platform — ${APP_STATS.mostPopularRoutineShare} of all routines families create.`,
  },
  {
    name: "Dinner Cleanup",
    cadence: "Daily",
    pillar: "🏠 Home Care",
    steps: ["Clear the table", "Load the dishwasher", "Wipe the counters", "Sweep the floor"],
    note: "The second most-completed routine — four short chores that close down the kitchen as a team.",
  },
  {
    name: "Laundry Day",
    cadence: "Weekly",
    pillar: "🛠️ Life Skills",
    steps: ["Collect and sort laundry", "Run the washer", "Move to the dryer", "Fold and put away"],
    note: "The top routine for ages 11–12 — a complete life skill practiced start to finish every week.",
  },
  {
    name: "Weekly Reset",
    cadence: "Weekly",
    pillar: "📋 Organization",
    steps: ["Tidy bedroom", "Change bed linens", "Empty all trash", "Plan the week ahead"],
    note: "The most-completed routine among 15–16 year olds preparing to run their own space.",
  },
];

const routineMechanics = [
  {
    label: "One step at a time",
    title: "The dashboard shows only the next step",
    body: "A six-step routine never floods a child's list. They see the next incomplete chore with a progress badge (\"Clean Room 2/4\") and tap it to view the whole sequence — focus for kids, structure for parents.",
  },
  {
    label: "Real chores inside",
    title: "Every step is a genuine chore",
    body: "Routine steps are the same chores you already use — with their own coins, parent approval where you've set it, and the +5 New Skill Bonus the first time a child completes something new.",
  },
  {
    label: "Set the cadence",
    title: "Daily, weekly, monthly — automatically",
    body: "Give a routine a repeat schedule and a fresh copy appears when the last one is finished. Morning routines daily, laundry weekly, deep cleans monthly: the calendar work is done for you.",
  },
  {
    label: "Finish-line rewards",
    title: "Completing the whole routine pays extra",
    body: `Each step pays its own coins and +${APP_STATS.routineStepXp} Responsibility XP; finishing the final step triggers a routine completion bonus — bonus coins you choose plus +${APP_STATS.routineBonusXp} XP toward the routine's Responsibility Pillar.`,
  },
];

const cadenceGuide = [
  {
    label: "Daily routines",
    title: "Anchor the day's transitions",
    body: "Morning, after school, and bedtime are the three moments families automate first. Keep daily routines to 3–5 short steps a child can finish in under 20 minutes.",
  },
  {
    label: "Weekly routines",
    title: "Teach complete skills",
    body: "Laundry Day, Room Reset, Pet Care Day. Weekly routines are where kids practice a full skill cycle — plan, do, finish — and where the platform sees the biggest completion gains.",
  },
  {
    label: "Monthly routines",
    title: "Build maintenance thinking",
    body: "Deep-clean the bathroom, swap seasonal clothes, wash the car. Monthly routines teach the adult habit of maintaining things before they break — ideal from about age 11 up.",
  },
];

const faqs = [
  {
    question: "What is a chore routine?",
    answer:
      "A routine is a named, reusable sequence of chores — like Clean Room: make the bed, pick up the floor, put away clothes, empty the trash. Instead of assigning four separate chores, you assign the routine once and your child works through it step by step.",
  },
  {
    question: "Why do routines work better than individual chores?",
    answer:
      "Routines remove decision-making. A child doesn't negotiate four tasks — they follow one familiar sequence until it becomes automatic. Across Family Chores, families that use routines complete 31% more chores than families assigning the same work as separate tasks.",
  },
  {
    question: "How many steps should a routine have?",
    answer:
      "Across the platform routines average 4.2 steps, and that's a good target: enough to feel like a real accomplishment, short enough to finish in one sitting. Younger kids do best with 3, teens handle 5–6.",
  },
  {
    question: "How do routines connect to the Pillars of Responsibility?",
    answer:
      "Each routine belongs to one of five pillars — Home Care, Self Care, Organization, Family Contribution, or Life Skills. Completing steps and finishing routines earns Responsibility XP in that pillar, so repeated routines literally level up the life skill they practice.",
  },
];

export function routinesFaqStructuredData() {
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

export function MarketingRoutinesPage() {
  return (
    <main className="marketing-home">
      <section
        className="marketing-hero marketing-routines-hero panel"
        aria-labelledby="routines-page-title">
        <div className="marketing-hero-grid">
          <div className="marketing-hero-copy marketing-hero-copy-plain">
            <span className="marketing-hero-kicker">Chore routines for kids</span>
            <h1 id="routines-page-title">
              Group today&apos;s chores into routines that build tomorrow&apos;s habits.
            </h1>
            <p>
              A chore gets done once. A routine gets done every day until it doesn&apos;t
              need a reminder anymore. Family Chores lets you bundle chores into reusable
              daily, weekly, and monthly routines — each one feeding a Pillar of
              Responsibility your child can watch grow.
            </p>
            <div className="marketing-hero-actions">
              <Link href="/" className="btn btn-primary">
                Build your first routine
              </Link>
              <Link href="#example-routines" className="btn btn-secondary">
                See example routines
              </Link>
            </div>
          </div>
          <div className="marketing-hero-side">
            <MarketingImageFrame
              src={routinesWorkflowImage}
              alt="Family Chores routine workflow."
              priority
              className="marketing-image-hero"
            />
          </div>
        </div>
      </section>

      <section
        className="marketing-section"
        id="example-routines"
        aria-labelledby="example-routines-title">
        <MarketingSectionIntro
          id="example-routines-title"
          eyebrow="Start with a proven pattern"
          title="The routines families build first."
          description="Pulled from the most-created and most-completed routines across the platform. Copy them as-is or customize the steps for your house — every step is a real chore with its own coins and approval rules."
        />
        <div className="marketing-card-grid">
          {exampleRoutines.map((routine) => (
            <article key={routine.name} className="marketing-info-card">
              <span className="marketing-card-label">
                {routine.cadence} · {routine.pillar}
              </span>
              <h3>{routine.name}</h3>
              <ul className="marketing-checklist">
                {routine.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ul>
              <p className="small">{routine.note}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="marketing-section" aria-labelledby="routine-mechanics-title">
        <MarketingSectionIntro
          id="routine-mechanics-title"
          eyebrow="How routines work here"
          title="Designed so the sequence does the parenting."
          description="Routines in Family Chores aren't a checklist PDF — they're live objects with progress, rewards, and repeat schedules."
        />
        <div className="marketing-card-grid">
          {routineMechanics.map((card) => (
            <article key={card.title} className="marketing-info-card">
              <span className="marketing-card-label">{card.label}</span>
              <h3>{card.title}</h3>
              <p>{card.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="marketing-section" aria-labelledby="cadence-title">
        <MarketingSectionIntro
          id="cadence-title"
          eyebrow="Daily, weekly, monthly"
          title="Match the cadence to the lesson."
          description="Different repeat schedules teach different things. Most families end up with a small stack of each."
        />
        <div className="marketing-card-grid">
          {cadenceGuide.map((card) => (
            <article key={card.title} className="marketing-info-card">
              <span className="marketing-card-label">{card.label}</span>
              <h3>{card.title}</h3>
              <p>{card.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="marketing-section" aria-labelledby="routine-data-title">
        <MarketingSectionIntro
          id="routine-data-title"
          eyebrow="Routine planning guide"
          title="Routines, by the numbers."
          description="Practical benchmarks for building routines kids can actually finish."
        />
        <MarketingStatStrip
          ariaLabel="Platform routine statistics"
          stats={[
            {
              value: APP_STATS.recommendedDailyRoutineSteps,
              label: "focused steps for most daily routines",
            },
            {
              value: APP_STATS.routineCompletionBoost,
              label: "more chores completed by families that use routines",
            },
            { value: APP_STATS.averageRoutineSteps, label: "average steps per routine" },
            {
              value: APP_STATS.mostPopularRoutineShare,
              label: `of all routines are a ${APP_STATS.mostPopularRoutine} — mornings are where families start`,
            },
          ]}
        />
        <p className="marketing-hero-actions-note">
          Wondering which chores belong inside? Browse{" "}
          <Link href="/chores">chores for kids</Link> and the age guides, then see how
          routines roll up into the{" "}
          <Link href="/pillars-of-responsibility">Pillars of Responsibility</Link>.
        </p>
      </section>

      <section className="marketing-section" aria-labelledby="routines-faq-title">
        <MarketingSectionIntro
          id="routines-faq-title"
          eyebrow="Common questions"
          title="Routines: what parents ask us."
          description="The short version of what we recommend when parents start turning chores into routines."
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
        title="Turn this week's chores into next year's habits."
        body="Create a routine once — Morning Routine, Dinner Cleanup, Laundry Day — assign it with a repeat schedule, and let the sequence carry your child from reminded to responsible."
        secondaryHref="/pillars-of-responsibility"
        secondaryLabel="Explore the Pillars of Responsibility"
      />
    </main>
  );
}
