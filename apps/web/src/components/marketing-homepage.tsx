import Image from "next/image";
import Link from "next/link";
import { Alert } from "@/components/alert";
import { GoogleSignInButton } from "@/components/google-signin-button";

type MarketingHomepageProps = {
  googleClientId?: string;
  gsiLoginUri?: string;
  signInErrorMessage?: string;
};

const proofPoints = [
  "Parent-approved rewards",
  "Google Tasks sync",
  "Realtime family activity",
];

const comparisonCards = [
  {
    label: "Paper charts",
    title: "Beyond paper chore charts",
    body: "No erased boxes, no missed updates, and no guessing what still needs attention. Every chore has an assignee, a status, and a clear next step.",
  },
  {
    label: "Generic to-do apps",
    title: "Built for review, not just checkboxes",
    body: "Kids submit work for approval. Parents decide what counts, can give feedback, and rewards only move after review.",
  },
  {
    label: "Allowance apps",
    title: "Rewards that feel connected",
    body: "Coins feed into store choices, profile personalization, and visible family progress instead of feeling like a disconnected payout log.",
  },
  {
    label: "Household system",
    title: "One place for the whole workflow",
    body: "Family members, roles, chores, notifications, live activity, and personalization stay in one shared system instead of scattered tools.",
  },
];

const workflowSteps = [
  {
    title: "Parents assign chores and values",
    body: "Set the assignee, details, timing, and coin value so expectations are clear from the start.",
  },
  {
    title: "Kids complete and submit",
    body: "Players see their chores, finish the work, and submit it for review when it is ready.",
  },
  {
    title: "Parents approve or give feedback",
    body: "Admins keep standards consistent and can reject with feedback when a chore needs another pass.",
  },
  {
    title: "Rewards and family progress update",
    body: "Approval updates balances, unlocks store choices, and keeps household momentum visible for everyone.",
  },
];

const parentBenefits = [
  "Manage family members, roles, chores, and assignments",
  "Approve submissions before rewards are granted",
  "Track notifications, activity, and household progress",
];

const playerBenefits = [
  "See assigned chores and submit completed work",
  "Earn coins to unlock store items and personalization",
  "Customize avatars, themes, and celebration effects",
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
}: MarketingHomepageProps) {
  const hasGoogleCta = Boolean(googleClientId && gsiLoginUri);

  return (
    <main className="marketing-home">
      {signInErrorMessage ? (
        <Alert tone="warning" className="marketing-signin-alert">
          {signInErrorMessage}
        </Alert>
      ) : null}
      <section className="marketing-hero panel" aria-labelledby="marketing-home-title">
        <div className="marketing-hero-grid">
          <div className="hero-copy marketing-hero-copy">
            <span className="marketing-hero-kicker">Family Chores Game</span>
            <h1 id="marketing-home-title">
              A chore system families will actually use.
            </h1>
            <p>
              Parents stay in control, kids stay motivated, and rewards, activity, and
              Google-connected routines stay organized in one place.
            </p>
          </div>

          <div className="marketing-hero-side">
            <MarketingImageFrame
              src="/saas_interface.png"
              alt="Family Chores Game interface shown across desktop and mobile layouts."
              width={1536}
              height={1024}
              priority
              className="marketing-image-hero"
              caption="A shared family workspace across desktop and mobile."
            />

            <article className="marketing-side-card marketing-side-card-feature">
              <span className="marketing-card-label">Why families choose it</span>
              <h2>One place for chores, rewards, and family momentum.</h2>
              <p>
                Built for organized households that want better accountability without
                making chores feel like one more disconnected system.
              </p>
              <ul className="marketing-checklist">
                <li>Approval workflow keeps parents in control</li>
                <li>Rewards and personalization keep kids bought in</li>
                <li>Google-connected setup fits existing family routines</li>
              </ul>
            </article>

            <div className="marketing-side-grid">
              <article className="marketing-side-card">
                <span className="marketing-card-label">Structured workflow</span>
                <h3>Assign, submit, review, approve.</h3>
                <p>Every chore has clear ownership, status, and accountability.</p>
              </article>
              <article className="marketing-side-card">
                <span className="marketing-card-label">Live visibility</span>
                <h3>Updates do not go stale.</h3>
                <p>Realtime activity and notifications keep the whole household aligned.</p>
              </article>
            </div>
          </div>
        </div>

        <div className="marketing-proof-strip" aria-label="Key product highlights">
          {proofPoints.map((point) => (
            <div key={point} className="marketing-proof-item">
              <span className="marketing-proof-dot" aria-hidden="true" />
              <span>{point}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="marketing-section" aria-labelledby="why-different-title">
        <SectionIntro
          id="why-different-title"
          eyebrow="Why families switch"
          title="Built for real household follow-through, not just task lists."
          description="Most chore tools stop at checkboxes. Family Chores Game adds review, accountability, rewards, and visibility so the system actually works day to day."
        />
        <div className="marketing-card-grid">
          {comparisonCards.map((card) => (
            <article key={card.title} className="marketing-info-card">
              <span className="marketing-card-label">{card.label}</span>
              <h3>{card.title}</h3>
              <p>{card.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="marketing-section" id="how-it-works" aria-labelledby="how-it-works-title">
        <SectionIntro
          id="how-it-works-title"
          eyebrow="How it works"
          title="A clear workflow from assignment to approval."
          description="Rewards are earned through completion and parent review, not handed out automatically."
        />
        <div className="marketing-how-layout">
          <MarketingImageFrame
            src="/workflow.png"
            alt="Illustrated flow showing a parent assigning chores, a child submitting work, a parent reviewing, and rewards updating."
            width={1881}
            height={836}
            className="marketing-image-wide"
            caption="Assignment, submission, review, and rewards stay in one clear flow."
          />
          <div className="marketing-step-grid">
            {workflowSteps.map((step, index) => (
              <article key={step.title} className="marketing-step-card">
                <span className="marketing-step-number">0{index + 1}</span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="marketing-section" aria-labelledby="google-integration-title">
        <div className="marketing-spotlight panel">
          <div className="marketing-spotlight-copy">
            <span className="marketing-eyebrow">Works with Google</span>
            <h2 id="google-integration-title">Fits into the tools your family already uses.</h2>
            <p>
              For families already organized around Google accounts and Google Tasks,
              Family Chores Game adds a household layer on top of that workflow. Linked
              task lists can sync into the chore system so parents keep structure, kids
              keep accountability, and the family does not have to rebuild everything
              from scratch in another app.
            </p>
            <p className="marketing-spotlight-note">
              Use the routine you already have. Add the approval, rewards, and visibility
              it is missing.
            </p>
          </div>

          <article className="marketing-spotlight-card">
            <span className="marketing-card-label">Connected workflow</span>
            <h3>Bring Google Tasks into a family-ready system.</h3>
            <ul className="marketing-checklist">
              <li>Sync selected Google task lists into household chore workflows</li>
              <li>Keep parent approval and reward rules on top of synced tasks</li>
              <li>Reduce duplicate task entry for busy families already using Google</li>
            </ul>
          </article>
        </div>
      </section>

      <section className="marketing-section" aria-labelledby="whole-household-title">
        <SectionIntro
          id="whole-household-title"
          eyebrow="Designed for both roles"
          title="Structure for parents. Motivation for kids."
          description="The platform gives each side of the household what it actually needs instead of forcing everyone into the same flat task list."
        />
        <div className="marketing-role-layout">
          <div className="marketing-role-grid">
            <article className="marketing-role-card">
              <span className="marketing-card-label">Admin experience</span>
              <h3>Parents stay in control</h3>
              <p>
                Manage the household, set expectations, and decide when rewards are earned.
              </p>
              <ul className="marketing-bullet-list">
                {parentBenefits.map((benefit) => (
                  <li key={benefit}>{benefit}</li>
                ))}
              </ul>
            </article>

            <article className="marketing-role-card">
              <span className="marketing-card-label">Player experience</span>
              <h3>Kids get a system they want to use</h3>
              <p>
                Chores feel more tangible when progress, rewards, and personalization all
                live in the same place.
              </p>
              <ul className="marketing-bullet-list">
                {playerBenefits.map((benefit) => (
                  <li key={benefit}>{benefit}</li>
                ))}
              </ul>
            </article>
          </div>

          <MarketingImageFrame
            src="/saas_flow.png"
            alt="Illustrated product flow showing profile personalization, family communication, and rewards redemption."
            width={1536}
            height={1024}
            className="marketing-image-tall"
            caption="Rewards, profiles, and family progress feel connected instead of separate."
          />
        </div>
      </section>

      <section className="marketing-section" aria-labelledby="live-visibility-title">
        <div className="marketing-visibility panel">
          <div className="marketing-visibility-top">
            <div className="marketing-visibility-copy">
              <span className="marketing-eyebrow">Live visibility</span>
              <h2 id="live-visibility-title">
                The household stays aligned without constant follow-up.
              </h2>
              <p>
                Family activity updates in realtime, so the app feels current instead of
                static. Parents can quickly see what changed, kids can see progress move,
                and notifications help everyone stay on the same page without extra reminders.
              </p>
            </div>

            <MarketingImageFrame
              src="/prizes.png"
              alt="Family Chores Game interface highlighting notifications, approvals, and rewards across desktop and mobile."
              width={1536}
              height={1024}
              className="marketing-image-visibility"
              caption="Activity, approval, and rewards stay visible across the household."
            />
          </div>

          <div className="marketing-activity-grid" aria-label="Sample household activity highlights">
            <article className="marketing-activity-card">
              <span className="marketing-card-label">Activity feed</span>
              <p>Mia submitted Kitchen cleanup for review.</p>
            </article>
            <article className="marketing-activity-card">
              <span className="marketing-card-label">Approval status</span>
              <p>Rewards update only after parent approval, not on an unchecked claim.</p>
            </article>
            <article className="marketing-activity-card">
              <span className="marketing-card-label">Shared visibility</span>
              <p>Notifications and live updates reduce the "Did anyone do this yet?" loop.</p>
            </article>
          </div>
        </div>
      </section>

      <section className="marketing-section" id="get-started" aria-labelledby="get-started-title">
        <div className="marketing-final-cta panel">
          <span className="badge marketing-final-badge">Ready to get organized?</span>
          <h2 id="get-started-title">
            Bring structure to chores without losing buy-in from kids.
          </h2>
          <p>
            Family Chores Game gives parents a system they can trust and gives kids
            rewards and personalization that make participation feel worth it.
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
            <Link href="#how-it-works" className="btn btn-secondary">
              See how it works
            </Link>
          </div>
          <p className="marketing-final-note">
            {hasGoogleCta
              ? "Google sign-in is the fastest way to get your household started."
              : "Configure Google sign-in to enable the fastest start for new families."}
          </p>
        </div>
      </section>
    </main>
  );
}
