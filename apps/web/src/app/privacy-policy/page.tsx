import type { Metadata } from "next";
import { LegalDocumentContent } from "@/components/legal-document-content";
import { getPrivacyPolicy } from "@/lib/legal/loader";

export const metadata: Metadata = {
  title: "Privacy Policy | Family Chores",
  description: "How Family Chores collects, uses, and protects your data.",
};

export default function PrivacyPolicyPage() {
  const doc = getPrivacyPolicy();
  return <LegalDocumentContent document={doc} />;
}
