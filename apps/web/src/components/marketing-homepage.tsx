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
  "Flexible approval rules",
  "Managed child profiles",
  "Family awards, quests, and live activity",
];

const comparisonCards = [
  {
    label: "Flexible workflow",
    title: "Built for more than one kind of chore",
    body: "Use standard chores, group or family chores, and See and Do chores so the system fits the job instead of forcing every task into the same template.",
  },
  {
    label: "Real accountability",
    title: "Approval when you need it, instant payout when you do not",
    body: "Parents can require review for chores that need a second look, while other chores can approve immediately and pay coins as soon as they are completed.",
  },
  {
    label: "Kid motivation",
    title: "Progress feels tangible",
    body: "Coins, unlocks, quest content, themes, avatars, confetti, and visible household progress give kids concrete signals that effort leads somewhere.",
  },
  {
    label: "Household control",
    title: "One system for parents, kids, and managed profiles",
    body: "Create managed child profiles, switch between accounts with a parent PIN, and add invite or Google-link flows only when your family actually needs them.",
  },
];

const workflowSteps = [
  {
    title: "Set up the family the way your household works",
    body: "Families can start with managed child profiles and use PIN-protected Switch Account, while invite and Google-link options stay available for later when needed.",
  },
  {
    title: "Choose the right chore type and rules",
    body: "Assign standard chores, group or family chores, or See and Do chores with coin values, approval rules, and optional recurrence.",
  },
  {
    title: "Completion follows the path you configured",
    body: "Some chores pay coins immediately on completion. Approval-required chores move into review first, and group or See and Do chores stay parent-controlled.",
  },
  {
    title: "Rewards, awards, and progress keep moving",
    body: "Coins feed store unlocks, family awards, quest items, and visible progress that keeps responsibility tied to real outcomes.",
  },
];

const choreTypeCards = [
  {
    label: "Standard",
    title: "Everyday chores for one person",
    body: "Great for normal assigned work. Parents can choose whether a standard chore pays immediately on completion or waits for approval.",
  },
  {
    label: "Group / Family",
    title: "Shared chores for multiple people or the whole house",
    body: "Use family assignment or multiple assignees when everyone needs to help. These chores stay approval-based so parents can confirm the work and adjust coins at approval time.",
  },
  {
    label: "See and Do",
    title: "Parent-reviewed chores that kids can notice and claim",
    body: "Ideal for jobs that are not always scheduled in advance. See and Do chores always require parent approval, and parents assign the coin value during approval.",
  },
];

const familyFeatureCards = [
  {
    label: "Managed child profiles",
    title: "Start with safe parent-managed accounts",
    body: "Parents can create player profiles without email first, switch into them with a PIN, and link Google later only if that child eventually needs a direct sign-in.",
  },
  {
    label: "Family awards",
    title: "Offer rewards your household actually cares about",
    body: "Parents can create custom family awards with coin amounts, imagery, and redemption limits so rewards match real family goals.",
  },
  {
    label: "Quests",
    title: "Turn bigger goals into guided adventures",
    body: "The app includes family quests and interactive quest content for households that want bigger goals to feel more guided than a single checkbox.",
  },
];

const parentBenefits = [
  "Create chores with assignee scope, approval, coin values, and recurrence",
  "Manage invited members and managed child profiles from the same household system",
  "Review notifications, approvals, family awards, and quest content in one place",
];

const playerBenefits = [
  "See clear progress, complete chores, and understand what ownership looks like",
  "Earn coins for store unlocks, family awards, quest items, and personalization",
  "Explore quest content and customize avatars, themes, and celebration effects",
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
            <h1 id="marketing-home-title">A chore system families will actually keep using.</h1>
            <p>
              Parents get structure and control. Kids get visible progress, rewards,
              and game-like momentum that help responsibility feel real instead of abstract.
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
              <h2>One place for chores, rewards, quest content, and family momentum.</h2>
              <p>
                Built for households that want a system that can handle everyday chores,
                shared responsibilities, custom rewards, and longer-term goals.
              </p>
              <ul className="marketing-checklist">
                <li>Flexible chores with optional approval and recurrence</li>
                <li>Managed child profiles with PIN-protected Switch Account</li>
                <li>Rewards, family awards, and quest content that make progress visible</li>
              </ul>
            </article>

            <div className="marketing-side-grid">
              <article className="marketing-side-card">
                <span className="marketing-card-label">Structured workflow</span>
                <h3>Assign, complete, review when needed.</h3>
                <p>Every chore has clear ownership, status, and the right level of parent control.</p>
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
          description="Family Chores Game combines chore assignment, approvals, rewards, profiles, and long-term motivation so the system still works after the first week."
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
          title="A clear workflow from setup to visible progress."
          description="The app supports both instant-payout chores and approval-based chores, so families can match the workflow to the task."
        />
        <div className="marketing-how-layout">
          <MarketingImageFrame
            src="/workflow.png"
            alt="Illustrated flow showing a parent assigning chores, a child completing work, a parent reviewing when needed, and rewards updating."
            width={1881}
            height={836}
            className="marketing-image-wide"
            caption="Assignment, completion, review, and rewards stay in one clear flow."
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

      <section className="marketing-section" aria-labelledby="chore-types-title">
        <SectionIntro
          id="chore-types-title"
          eyebrow="Chore types"
          title="Use the right type of chore for the job."
          description="Not every responsibility works the same way. The app supports one-person chores, shared chores, and parent-reviewed claimable chores."
        />
        <div className="marketing-card-grid">
          {choreTypeCards.map((card) => (
            <article key={card.title} className="marketing-info-card">
              <span className="marketing-card-label">{card.label}</span>
              <h3>{card.title}</h3>
              <p>{card.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="marketing-section" aria-labelledby="google-integration-title">
        <div className="marketing-spotlight panel">
          <div className="marketing-spotlight-copy">
            <span className="marketing-eyebrow">Works with Google</span>
            <h2 id="google-integration-title">Fits into the tools your family already uses.</h2>
            <p>
              For families already organized around Google accounts and Google Tasks,
              Family Chores Game adds a household layer on top. Selected task lists can
              sync into the chore system so parents keep structure, kids keep accountability,
              and the family does not have to rebuild everything from scratch.
            </p>
            <p className="marketing-spotlight-note">
              Use the routine you already have. Add household visibility, rewards, and
              the level of approval each chore actually needs.
            </p>
          </div>

          <article className="marketing-spotlight-card">
            <span className="marketing-card-label">Connected workflow</span>
            <h3>Bring Google Tasks into a family-ready system.</h3>
            <ul className="marketing-checklist">
              <li>Sync selected Google task lists into household chore workflows</li>
              <li>Layer in approvals, rewards, and family visibility where useful</li>
              <li>Reduce duplicate task entry for busy families already using Google</li>
            </ul>
          </article>
        </div>
      </section>

      <section className="marketing-section" aria-labelledby="family-features-title">
        <SectionIntro
          id="family-features-title"
          eyebrow="Beyond chores"
          title="Profiles, awards, and quest content keep the system growing with your family."
          description="The app is not limited to a single chore list. It gives parents more ways to manage access, shape rewards, and guide bigger goals."
        />
        <div className="marketing-card-grid">
          {familyFeatureCards.map((card) => (
            <article key={card.title} className="marketing-info-card">
              <span className="marketing-card-label">{card.label}</span>
              <h3>{card.title}</h3>
              <p>{card.body}</p>
            </article>
          ))}
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
              <p>Manage the household, set expectations, and decide when rewards are earned.</p>
              <ul className="marketing-bullet-list">
                {parentBenefits.map((benefit) => (
                  <li key={benefit}>{benefit}</li>
                ))}
              </ul>
            </article>

            <article className="marketing-role-card">
              <span className="marketing-card-label">Player experience</span>
              <h3>Kids get a system that rewards ownership</h3>
              <p>
                For kids who love games and visible progress, the app turns responsibility
                into something they can see building over time instead of hearing about after the fact.
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
            alt="Illustrated product flow showing profile personalization, family communication, rewards, and quest-style progress."
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
              <h2 id="live-visibility-title">The household stays aligned without constant follow-up.</h2>
              <p>
                Family activity updates in realtime, so the app feels current instead of
                static. Parents can quickly see what changed, kids can see progress move,
                and notifications help everyone stay on the same page without extra reminders.
              </p>
            </div>

            <MarketingImageFrame
              src="/prizes.png"
              alt="Family Chores Game interface highlighting notifications, approvals, rewards, and progress across desktop and mobile."
              width={1536}
              height={1024}
              className="marketing-image-visibility"
              caption="Activity, rewards, and progress stay visible across the household."
            />
          </div>

          <div className="marketing-activity-grid" aria-label="Sample household activity highlights">
            <article className="marketing-activity-card">
              <span className="marketing-card-label">Activity feed</span>
              <p>Mia completed Kitchen cleanup and it moved straight into the family timeline.</p>
            </article>
            <article className="marketing-activity-card">
              <span className="marketing-card-label">Approval status</span>
              <p>Approval-required chores wait for review, while eligible chores can approve and pay coins immediately.</p>
            </article>
            <article className="marketing-activity-card">
              <span className="marketing-card-label">Shared visibility</span>
              <p>Notifications and live updates reduce the &quot;Did anyone do this yet?&quot; loop.</p>
            </article>
          </div>
        </div>
      </section>

      <section className="marketing-section" id="get-started" aria-labelledby="get-started-title">
        <div className="marketing-final-cta panel">
          <span className="badge marketing-final-badge">Ready to get organized?</span>
          <h2 id="get-started-title">Make responsibility feel visible and worth owning.</h2>
          <p>
            Family Chores Game gives parents a system they can trust and gives kids
            tangible signs of ownership through rewards, unlocks, quest content, and visible momentum.
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
              ? "Google sign-in gets the parent account started quickly, and most child profiles can be managed through PIN-protected Switch Account."
              : "Configure Google sign-in to enable the fastest start for new families."}
          </p>
        </div>
      </section>
    </main>
  );
}
