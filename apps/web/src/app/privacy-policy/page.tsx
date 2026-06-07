import type { Metadata } from "next";
import { LegalDocumentContent } from "@/components/legal-document-content";
import { getPrivacyPolicy } from "@/lib/legal/loader";

const PRIVACY_DESCRIPTION =
  "How Family Chores collects, uses, and protects your family's data, including child profiles and parental consent.";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: PRIVACY_DESCRIPTION,
  alternates: { canonical: "/privacy-policy" },
  openGraph: {
    type: "article",
    title: "Privacy Policy | Family Chores",
    description: PRIVACY_DESCRIPTION,
    url: "/privacy-policy",
  },
};

export default function PrivacyPolicyPage() {
  const doc = getPrivacyPolicy();
  return <LegalDocumentContent document={doc} />;
}
