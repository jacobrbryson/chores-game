import type { Metadata } from "next";
import { LegalDocumentContent } from "@/components/legal-document-content";
import { getTermsOfService } from "@/lib/legal/loader";

export const metadata: Metadata = {
  title: "Terms of Service | Family Chores",
  description: "Terms for using the Family Chores app.",
};

export default function TermsOfServicePage() {
  const doc = getTermsOfService();
  return <LegalDocumentContent document={doc} />;
}
