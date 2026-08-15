import Image from "next/image";
import Link from "next/link";
import { Alert } from "@/components/alert";
import { AppleSignInButton } from "@/components/apple-signin-button";
import { GoogleSignInButton } from "@/components/google-signin-button";

type MarketingHomepageProps = {
  googleClientId?: string;
  gsiLoginUri?: string;
  signInErrorMessage?: string;
  appleClientId?: string;
  appleRedirectUri?: string;
  appleLabel: string;
  applePendingLabel: string;
  appleFailedMessage: string;
};

// A playful peek at the family feed — the product's personality, not a
// metrics dashboard. (Deep-dive numbers live on the guide pages.)
const heroMoments = [
  { emoji: "🛏️", text: "Maya finished Make the Bed", reward: "+10 🪙" },
  { emoji: "🎉", text: "Leo completed his whole Morning Routine!", reward: "+5 bonus" },
  { emoji: "✨", text: "First time mowing the lawn — New Skill learned!", reward: "+5 🪙" },
  { emoji: "🌱", text: "Self Care just hit Level 3", reward: "Level up!" },
];

const pillarTiles = [
  {
    id: "home_care",
    emoji: "🏠",
    title: "Home Care",
    body: "Dishes, laundry, yard work — caring for the space they live in.",
  },
  {
    id: "self_care",
    emoji: "🌱",
    title: "Self Care",
    body: "Morning routines and personal responsibility, handled independently.",
  },
  {
    id: "organization",
    emoji: "📋",
    title: "Organization",
    body: "Planning, packing, and keeping life orderly.",
  },
  {
    id: "family_contribution",
    emoji: "🤝",
    title: "Family Contribution",
    body: "Helping siblings and pitching in for the household.",
  },
  {
    id: "life_skills",
    emoji: "🛠️",
    title: "Life Skills",
    body: "Cooking, budgeting, and practical adulthood skills.",
  },
];

const pathCards = [
  {
    href: "/chores",
    accent: "sky",
    emoji: "✅",
    meta: "Chores · ages 5–16",
    title: "Chores that fit your kid",
    body: "Age-by-age guides packed with chore ideas — from sock-matching at five to cooking dinner at fifteen — plus coins, rewards, and a New Skill Bonus that makes trying new things exciting.",
    cta: "Browse chore ideas by age →",
  },
  {
    href: "/routines",
    accent: "emerald",
    emoji: "🔁",
    meta: "Routines · daily, weekly, monthly",
    title: "Chain chores into habits",
    body: "Morning Routine, Dinner Cleanup, Laundry Day — reusable sequences with step-by-step progress and completion bonuses. The structure does the reminding.",
    cta: "See example routines →",
  },
  {
    href: "/pillars-of-responsibility",
    accent: "violet",
    emoji: "🏛️",
    meta: "The system · Responsibility XP",
    title: "Watch life skills level up",
    body: "Every chore and routine feeds one of five Responsibility Pillars. Kids level up Home Care, Self Care, and more — growing up becomes a game they can see themselves winning.",
    cta: "Meet the five pillars →",
  },
];

// "How it works" as a day in the life — four connected moments instead of a
// feature list.
const journeySteps = [
  {
    emoji: "🌙",
    when: "Sunday night",
    actor: "Parent",
    accent: "sky",
    title: "Set it up once",
    body: "Add the kids, pick chores and routines, set coins and repeat schedules. Ten minutes on the couch — then the system takes the night shift.",
    chip: { emoji: "📋", text: "Dinner Cleanup assigned to Leo", reward: "daily" },
  },
  {
    emoji: "🌅",
    when: "Monday morning",
    actor: "Kid",
    accent: "amber",
    title: "They see exactly what's theirs",
    body: "Their own dashboard (or the kitchen tablet in Kiosk Mode) shows what's next — one routine step at a time, no nagging required.",
    chip: { emoji: "🛏️", text: "Make the Bed — up next", reward: "1 / 4" },
  },
  {
    emoji: "✅",
    when: "After school",
    actor: "Together",
    accent: "emerald",
    title: "Done means done — or reviewed",
    body: "Trusted chores pay coins the second they're checked off. Anything you've flagged waits for your quick approval, payout adjustable on the spot.",
    chip: { emoji: "🎉", text: "Whole routine finished!", reward: "+10 🪙" },
  },
  {
    emoji: "🏆",
    when: "All week long",
    actor: "Everyone",
    accent: "violet",
    title: "Progress everyone can feel",
    body: "Coins turn into store unlocks and family awards, and every chore quietly levels up a Responsibility Pillar in the background.",
    chip: { emoji: "🌱", text: "Self Care reached Level 2", reward: "Level up!" },
  },
];

const roleParent = [
  "Create chores with assignees, approvals, coins, and recurrence",
  "Assign reusable routines from the same dashboard",
  "Review approvals, awards, and the family feed in one place",
];

const rolePlayer = [
  "A clear list, a Kiosk Mode for shared tablets, and visible progress",
  "Coins for store unlocks, family awards, and personalization",
  "Responsibility levels that make growing up feel like leveling up",
];

function SectionIntro({
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

function MarketingImageFrame({
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
      {caption ? <figcaption className="marketing-image-caption">{caption}</figcaption> : null}
    </figure>
  );
}

export function MarketingHomepage({
  googleClientId,
  gsiLoginUri,
  signInErrorMessage,
  appleClientId,
  appleRedirectUri,
  appleLabel,
  applePendingLabel,
  appleFailedMessage,
}: MarketingHomepageProps) {
  const hasGoogleCta = Boolean(googleClientId && gsiLoginUri);

  return (
    <main className="marketing-home">
      {signInErrorMessage ? (
        <Alert tone="warning" className="marketing-signin-alert">
          {signInErrorMessage}
        </Alert>
      ) : null}

      {/* Hero: dark gradient band with the single primary CTA. */}
      <section className="mh2-hero" aria-labelledby="marketing-home-title">
        <span className="mh2-hero-kicker">Family Chores Game</span>
        <h1 id="marketing-home-title">
          Raise kids who <span className="mh2-hero-highlight">handle things</span>.
        </h1>
        <p className="mh2-hero-sub">
          Family Chores turns everyday household tasks into a system kids actually follow —
          coins and rewards today, routines that become habits this month, and five
          Pillars of Responsibility that grow into real life skills over the years.
        </p>
        <div className="mh2-hero-actions">
          {hasGoogleCta ? (
            <GoogleSignInButton
              mode="gsi"
              clientId={googleClientId!}
              loginUri={gsiLoginUri!}
              width={280}
              includeOnload={false}
              includeScript={false}
              wrapperClassName="google-signin-wrap marketing-google-cta"
            />
          ) : (
            <Link href="#get-started" className="btn btn-primary">
              Start your family
            </Link>
          )}
          {appleClientId && appleRedirectUri ? (
            <AppleSignInButton
              clientId={appleClientId}
              redirectUri={appleRedirectUri}
              label={appleLabel}
              pendingLabel={applePendingLabel}
              failedMessage={appleFailedMessage}
            />
          ) : null}
        </div>
        <p className="mh2-hero-note">
          Free to start. Sign in with Google and assign your first chore in under five minutes.
        </p>

        <div className="mh2-hero-pillar-chips" aria-label="The five Responsibility Pillars">
          {pillarTiles.map((pillar) => (
            <Link
              key={pillar.id}
              href="/pillars-of-responsibility"
              className="mh2-pillar-chip">
              <span aria-hidden="true">{pillar.emoji}</span>
              {pillar.title}
            </Link>
          ))}
        </div>

        <div className="mh2-hero-feed" aria-label="Moments from a family's day">
          {heroMoments.map((moment) => (
            <div key={moment.text} className="mh2-hero-moment">
              <span className="mh2-hero-moment-emoji" aria-hidden="true">
                {moment.emoji}
              </span>
              <span className="mh2-hero-moment-text">{moment.text}</span>
              <span className="mh2-hero-moment-reward">{moment.reward}</span>
            </div>
          ))}
        </div>
      </section>

      {/* The three flagship destinations. */}
      <section className="marketing-section" aria-labelledby="paths-title">
        <SectionIntro
          id="paths-title"
          eyebrow="Start anywhere"
          title="Chores today. Routines this month. Responsibility for life."
          description="Three layers, one system — each one builds on the last, and each has a full guide you can read before you ever sign in."
        />
        <div className="mh2-paths">
          {pathCards.map((card) => (
            <Link key={card.href} href={card.href} className="mh2-path-card" data-accent={card.accent}>
              <span className="mh2-path-emoji" aria-hidden="true">
                {card.emoji}
              </span>
              <span className="mh2-path-meta">{card.meta}</span>
              <h3>{card.title}</h3>
              <p>{card.body}</p>
              <span className="mh2-path-cta">{card.cta}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* Pillar band. */}
      <section
        className="marketing-section"
        id="responsibility-pillars"
        aria-labelledby="responsibility-pillars-title">
        <SectionIntro
          id="responsibility-pillars-title"
          eyebrow="The Pillars of Responsibility"
          title="Five skills. One capable young adult."
          description="Tag any chore or routine with a pillar and every completion earns Responsibility XP — a growth chart that means more than a checked box."
        />
        <div className="mh2-pillar-band">
          {pillarTiles.map((pillar) => (
            <Link
              key={pillar.id}
              href="/pillars-of-responsibility"
              className="mh2-pillar-tile"
              data-pillar={pillar.id}>
              <span className="mh2-pillar-emoji" aria-hidden="true">
                {pillar.emoji}
              </span>
              <h3>{pillar.title}</h3>
              <p>{pillar.body}</p>
            </Link>
          ))}
        </div>
        <p className="marketing-hero-actions-note">
          See exactly how XP, levels, and routines fit together on the{" "}
          <Link href="/pillars-of-responsibility">Pillars of Responsibility</Link> page.
        </p>
      </section>

      {/* How it works: a day in the life, told as a connected journey. */}
      <section className="marketing-section" id="how-it-works" aria-labelledby="how-it-works-title">
        <SectionIntro
          id="how-it-works-title"
          eyebrow="How it works"
          title="One quiet Sunday setup. A whole week that runs itself."
          description="Here's what Family Chores actually looks like in a real house, from couch to high-five."
        />
        <ol className="mh2-journey">
          {journeySteps.map((step, index) => (
            <li key={step.title} className="mh2-journey-step" data-accent={step.accent}>
              <div className="mh2-journey-marker">
                <span className="mh2-journey-emoji" aria-hidden="true">
                  {step.emoji}
                </span>
                <span className="mh2-journey-index" aria-hidden="true">
                  {index + 1}
                </span>
              </div>
              <div className="mh2-journey-meta">
                <span className="mh2-journey-when">{step.when}</span>
                <span className="mh2-journey-actor">{step.actor}</span>
              </div>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
              <div className="mh2-journey-chip" aria-hidden="true">
                <span className="mh2-journey-chip-emoji">{step.chip.emoji}</span>
                <span className="mh2-journey-chip-text">{step.chip.text}</span>
                <span className="mh2-hero-moment-reward">{step.chip.reward}</span>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* Both roles. */}
      <section className="marketing-section" aria-labelledby="whole-household-title">
        <SectionIntro
          id="whole-household-title"
          eyebrow="Designed for both roles"
          title="Structure for parents. Motivation for kids."
          description="Each side of the household gets what it actually needs instead of a flat shared task list."
        />
        <div className="marketing-role-layout">
          <div className="marketing-role-grid">
            <article className="marketing-role-card">
              <span className="marketing-card-label">Parents</span>
              <h3>Set the rules once, then step back</h3>
              <p>Manage the household, set expectations, and decide when rewards are earned.</p>
              <ul className="marketing-bullet-list">
                {roleParent.map((benefit) => (
                  <li key={benefit}>{benefit}</li>
                ))}
              </ul>
            </article>

            <article className="marketing-role-card">
              <span className="marketing-card-label">Kids</span>
              <h3>Effort they can see paying off</h3>
              <p>
                Coins, unlocks, Family Awards, and Responsibility levels turn doing your part into
                progress kids can watch build over time.
              </p>
              <ul className="marketing-bullet-list">
                {rolePlayer.map((benefit) => (
                  <li key={benefit}>{benefit}</li>
                ))}
              </ul>
            </article>
          </div>

          <MarketingImageFrame
            src="/saas_flow.png"
            alt="Illustrated product flow showing profile personalization, family communication, rewards, and responsibility progress."
            width={1536}
            height={1024}
            className="marketing-image-tall"
            caption="Rewards, profiles, and family progress feel connected instead of separate. Kids can see what they have earned, who they are becoming, and what is next, while parents get one clear system instead of scattered charts, checklists, and reward rules."
          />
        </div>
      </section>

      {/* Live visibility + Google. */}
      <section className="marketing-section" aria-labelledby="live-visibility-title">
        <div className="marketing-visibility panel">
          <div className="marketing-visibility-top">
            <div className="marketing-visibility-copy">
              <span className="marketing-eyebrow">Live visibility</span>
              <h2 id="live-visibility-title">The household stays aligned without follow-up.</h2>
              <p>
                Family activity updates in realtime: completions, approvals, routine
                milestones, and rewards land in a shared feed the moment they happen.
                Already organized around Google? Selected Google Tasks lists can sync
                straight into the chore system.
              </p>
            </div>

            <MarketingImageFrame
              src="/prizes.png"
              alt="Family Chores interface highlighting notifications, approvals, rewards, and progress across desktop and mobile."
              width={1536}
              height={1024}
              className="marketing-image-visibility"
              caption="Activity, rewards, and progress stay visible across the household."
            />
          </div>

          <div className="marketing-activity-grid" aria-label="Sample household activity highlights">
            <article className="marketing-activity-card">
              <span className="marketing-card-label">Activity feed</span>
              <p>Mia finished step 3 of Dinner Cleanup — the whole routine pays a bonus when she&apos;s done.</p>
            </article>
            <article className="marketing-activity-card">
              <span className="marketing-card-label">Approvals</span>
              <p>Approval-required chores wait for review; trusted chores pay coins instantly.</p>
            </article>
            <article className="marketing-activity-card">
              <span className="marketing-card-label">Kiosk Mode</span>
              <p>A shared tablet in the kitchen, locked to a simple player-safe checklist.</p>
            </article>
          </div>
        </div>
      </section>

      {/* Final CTA. */}
      <section className="marketing-section" id="get-started" aria-labelledby="get-started-title">
        <div className="mh2-final">
          <span className="mh2-hero-kicker">Ready to start growing?</span>
          <h2 id="get-started-title">Raise capable, independent, responsible young adults.</h2>
          <p>
            Start with one chore tonight. Watch the coins, confetti, and high-fives kick in
            this week — and the life skills quietly stack up for years after.
          </p>
          <div className="marketing-final-actions">
            {hasGoogleCta ? (
              <GoogleSignInButton
                mode="gsi"
                clientId={googleClientId!}
                loginUri={gsiLoginUri!}
                width={280}
                includeOnload={false}
                includeScript={false}
                wrapperClassName="google-signin-wrap marketing-google-cta"
              />
            ) : (
              <Link href="#marketing-home-title" className="btn btn-primary">
                Get started
              </Link>
            )}
            {appleClientId && appleRedirectUri ? (
              <AppleSignInButton
                clientId={appleClientId}
                redirectUri={appleRedirectUri}
                label={appleLabel}
                pendingLabel={applePendingLabel}
                failedMessage={appleFailedMessage}
              />
            ) : null}
            <Link href="/chores" className="btn btn-secondary">
              Read the chores guide first
            </Link>
          </div>
          <p className="mh2-final-note">
            Google sign-in starts the parent account; kids join through managed profiles
            with PIN-protected Switch Account — no child emails required.
          </p>
        </div>
      </section>
    </main>
  );
}
