import type { Metadata } from "next";
import { BackLink } from "@/components/back-link";

export const metadata: Metadata = {
  title: "Privacy Policy | Family Chores",
  description: "How Family Chores collects, uses, and protects your data.",
};

export default function PrivacyPolicyPage() {
  return (
    <main className="panel family-page legal-page">
      <div className="page-header-row">
        <div className="page-header-inline">
          <BackLink className="page-back-link" ariaLabel="Go back" fallbackHref="/" />
          <h1>Privacy Policy</h1>
        </div>
      </div>
      <p className="small legal-updated">Last updated: March 9, 2026</p>

      <section className="legal-section">
        <h2>Overview</h2>
        <p>
          Family Chores is a family chore management game from Orcwood Games. This policy describes
          what information we collect, how we use it, and the choices you have when using the app.
        </p>
      </section>

      <section className="legal-section">
        <h2>Information We Collect</h2>
        <ul>
          <li>
            Account details such as name, email address, user ID, and profile photo from Google
            sign-in.
          </li>
          <li>
            Family workspace data including family memberships, roles, chores, submissions,
            approvals, notifications, and timestamps.
          </li>
          <li>
            Economy and customization data including wallet balances, ledger history, owned store
            options, and active avatar/theme/confetti choices.
          </li>
          <li>
            Optional Google Tasks sync data, including selected task lists and linked task metadata,
            when you choose to link Google Tasks.
          </li>
          <li>
            Basic technical data needed to operate the service, such as session and authentication
            tokens.
          </li>
        </ul>
      </section>

      <section className="legal-section">
        <h2>How We Use Information</h2>
        <ul>
          <li>Provide core app features, including chores, approvals, rewards, and profile settings.</li>
          <li>Authenticate users, enforce permissions, and secure family-only access.</li>
          <li>Sync chores with Google Tasks when requested by a linked user.</li>
          <li>Maintain transaction and activity records for reliability, auditing, and support.</li>
          <li>Improve performance, stability, and product quality.</li>
        </ul>
      </section>

      <section className="legal-section">
        <h2>How Information Is Shared</h2>
        <ul>
          <li>Within your family group so assigned members can view relevant chores and activity.</li>
          <li>
            With service providers used to run the app (for example, authentication, hosting, and
            database infrastructure).
          </li>
          <li>When required by law, regulation, legal process, or to protect rights and safety.</li>
        </ul>
        <p>We do not sell your personal information.</p>
      </section>

      <section className="legal-section">
        <h2>Data Retention</h2>
        <p>
          We keep information for as long as needed to provide the service, maintain records, comply
          with legal obligations, and resolve disputes. Retention periods may vary by data type.
        </p>
      </section>

      <section className="legal-section">
        <h2>Security</h2>
        <p>
          We use reasonable technical and organizational safeguards to protect data. No system is
          perfectly secure, so we cannot guarantee absolute security.
        </p>
      </section>

      <section className="legal-section">
        <h2>Children and Family Use</h2>
        <p>
          Family Chores is designed for family participation with parent or guardian oversight.
          Parents/guardians are responsible for managing household access and usage.
        </p>
      </section>

      <section className="legal-section">
        <h2>Your Choices</h2>
        <ul>
          <li>You can stop using the app at any time.</li>
          <li>You can unlink Google Tasks from your profile in the Profile page.</li>
          <li>You can contact us about privacy requests or concerns.</li>
        </ul>
      </section>

      <section className="legal-section">
        <h2>Contact</h2>
        <p>
          For privacy questions, visit
          {" "}
          <a href="https://orcwood.com" target="_blank" rel="noreferrer">
            Orcwood Games
          </a>
          .
        </p>
      </section>
    </main>
  );
}
