import type { Metadata } from "next";
import { BackLink } from "@/components/back-link";

export const metadata: Metadata = {
  title: "Terms of Service | Family Chores",
  description: "Terms for using the Family Chores app.",
};

export default function TermsOfServicePage() {
  return (
    <main className="panel family-page legal-page">
      <div className="page-header-row">
        <div className="page-header-inline">
          <BackLink className="page-back-link" ariaLabel="Go back" fallbackHref="/" />
          <h1>Terms of Service</h1>
        </div>
      </div>
      <p className="small legal-updated">Last updated: March 9, 2026</p>

      <section className="legal-section">
        <h2>Agreement to Terms</h2>
        <ul>
          <li>
            By using Family Chores, you agree to these Terms of Service. If you do not agree, do not
            use the app.
          </li>
        </ul>
      </section>

      <section className="legal-section">
        <h2>Service Description</h2>
        <ul>
          <li>
            Family Chores is a household task-management game where parents/guardians assign and review
            chores and players complete chores to earn in-app virtual currency and unlock cosmetic
            features.
          </li>
        </ul>
      </section>

      <section className="legal-section">
        <h2>Accounts and Roles</h2>
        <ul>
          <li>Access requires a valid sign-in account.</li>
          <li>Role permissions (for example, admin and player) are enforced by the service.</li>
          <li>
            Parents/guardians are responsible for how minors in their household access and use the
            app.
          </li>
        </ul>
      </section>

      <section className="legal-section">
        <h2>Acceptable Use</h2>
        <ul>
          <li>Attempt unauthorized access to any account, family, or data.</li>
          <li>Interfere with app operation, security features, or availability.</li>
          <li>Use the app for unlawful, abusive, or fraudulent activity.</li>
        </ul>
      </section>

      <section className="legal-section">
        <h2>Virtual Currency and Store Items</h2>
        <ul>
          <li>
            In-app coins and cosmetic items are virtual features with no cash value and are not
            redeemable for money.
          </li>
          <li>
            Coin payouts are governed by in-app workflow rules, including parent/guardian approvals.
          </li>
          <li>
            We may adjust in-app catalogs, pricing, and feature behavior to maintain service quality.
          </li>
        </ul>
      </section>

      <section className="legal-section">
        <h2>Third-Party Services</h2>
        <ul>
          <li>
            Family Chores may use third-party services (such as Google sign-in and optional Google
            Tasks sync). Your use of those services may also be subject to their terms and policies.
          </li>
        </ul>
      </section>

      <section className="legal-section">
        <h2>Intellectual Property</h2>
        <ul>
          <li>
            Family Chores, including its design, code, branding, and content, is owned by Orcwood
            Games or its licensors and is protected by applicable intellectual property laws.
          </li>
        </ul>
      </section>

      <section className="legal-section">
        <h2>Disclaimers</h2>
        <ul>
          <li>
            Family Chores is provided on an "as is" and "as available" basis. To the maximum extent
            permitted by law, we disclaim warranties of any kind, express or implied.
          </li>
        </ul>
      </section>

      <section className="legal-section">
        <h2>Limitation of Liability</h2>
        <ul>
          <li>
            To the maximum extent permitted by law, Orcwood Games is not liable for indirect,
            incidental, special, consequential, or punitive damages, or for loss of data, use, or
            profits arising from use of the app.
          </li>
        </ul>
      </section>

      <section className="legal-section">
        <h2>Termination</h2>
        <ul>
          <li>
            We may suspend or terminate access if these terms are violated, if required by law, or when
            necessary to protect the service or users.
          </li>
        </ul>
      </section>

      <section className="legal-section">
        <h2>Changes to Terms</h2>
        <ul>
          <li>
            We may update these Terms of Service from time to time. Continued use after updates means
            you accept the revised terms.
          </li>
        </ul>
      </section>

      <section className="legal-section">
        <h2>Contact</h2>
        <p>
          For terms questions, visit{" "}
          <a href="https://orcwood.com" target="_blank" rel="noreferrer">
            Orcwood Games
          </a>
          .
        </p>
      </section>
    </main>
  );
}
