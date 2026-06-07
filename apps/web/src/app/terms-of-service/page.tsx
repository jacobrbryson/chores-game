import type { Metadata } from "next";
import { LegalDocumentContent } from "@/components/legal-document-content";
import { getTermsOfService } from "@/lib/legal/loader";

const TERMS_DESCRIPTION =
  "The terms and conditions governing your use of the Family Chores app, including account, family management, and acceptable-use rules.";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: TERMS_DESCRIPTION,
  alternates: { canonical: "/terms-of-service" },
  openGraph: {
    type: "article",
    title: "Terms of Service | Family Chores",
    description: TERMS_DESCRIPTION,
    url: "/terms-of-service",
  },
};

export default function TermsOfServicePage() {
  const doc = getTermsOfService();
  return <LegalDocumentContent document={doc} />;
}
