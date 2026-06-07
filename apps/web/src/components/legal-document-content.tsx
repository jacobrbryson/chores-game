import type { LegalDocument, LegalDocumentSection } from "@/lib/legal/loader";

type LegalDocumentContentProps = {
  document: LegalDocument;
  className?: string;
};

export function LegalDocumentContent({
  document,
  className = "panel family-page family-page-shell legal-page",
}: LegalDocumentContentProps) {
  return (
    <div className={className}>
      <p className="small legal-updated">
        Version {document.version} &mdash; Effective {document.effectiveDate}
      </p>
      {document.sections.map((section) => (
        <LegalSection key={section.heading} section={section} />
      ))}
    </div>
  );
}

function LegalSection({ section }: { section: LegalDocumentSection }) {
  return (
    <section className="legal-section">
      <h2>{section.heading}</h2>
      {section.body?.map((paragraph, index) => (
        // eslint-disable-next-line react/no-array-index-key
        <p key={index}>{paragraph}</p>
      ))}
      {section.items && section.items.length > 0 ? (
        <ul>
          {section.items.map((item, index) => (
            // eslint-disable-next-line react/no-array-index-key
            <li key={index}>{item}</li>
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
