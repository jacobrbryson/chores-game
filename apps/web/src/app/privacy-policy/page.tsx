import type { Metadata } from "next";
import { getPrivacyPolicy } from "@/lib/legal/loader";
import type { LegalDocumentSection } from "@/lib/legal/loader";

export const metadata: Metadata = {
  title: "Privacy Policy | Family Chores",
  description: "How Family Chores collects, uses, and protects your data.",
};

export default function PrivacyPolicyPage() {
  const doc = getPrivacyPolicy();
  return (
    <main className="panel family-page family-page-shell legal-page">
      <p className="small legal-updated">
        Version {doc.version} &mdash; Effective {doc.effectiveDate}
      </p>
      {doc.sections.map((section) => (
        <LegalSection key={section.heading} section={section} />
      ))}
    </main>
  );
}

function LegalSection({ section }: { section: LegalDocumentSection }) {
  return (
    <section className="legal-section">
      <h2>{section.heading}</h2>
      {section.body?.map((paragraph, i) => (
        // eslint-disable-next-line react/no-array-index-key
        <p key={i}>{paragraph}</p>
      ))}
      {section.items && section.items.length > 0 ? (
        <ul>
          {section.items.map((item, i) => (
            // eslint-disable-next-line react/no-array-index-key
            <li key={i}>{item}</li>
          ))}
        </ul>
      ) : null}
      {section.links?.map((link) => (
        <p key={link.href}>
          <a href={link.href} target="_blank" rel="noreferrer">
            {link.text}
          </a>
        </p>
      ))}
    </section>
  );
}
