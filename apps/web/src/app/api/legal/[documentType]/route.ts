import { NextResponse } from "next/server";
import {
  getLegalDocument,
  getLegalDocumentByVersion,
  type LegalDocumentType,
} from "@/lib/legal/loader";

type RouteContext = {
  params: Promise<{ documentType: string }>;
};

function isLegalDocumentType(value: string): value is LegalDocumentType {
  return value === "privacy-policy" || value === "terms-of-service";
}

export async function GET(request: Request, context: RouteContext) {
  const { documentType } = await context.params;
  if (!isLegalDocumentType(documentType)) {
    return NextResponse.json({ error: "unknown_legal_document" }, { status: 404 });
  }

  const url = new URL(request.url);
  const version = url.searchParams.get("version")?.trim() ?? "";

  if (!version) {
    return NextResponse.json(getLegalDocument(documentType));
  }

  const document = getLegalDocumentByVersion(documentType, version);
  if (!document) {
    return NextResponse.json(
      { error: "legal_document_version_unavailable", requestedVersion: version },
      { status: 404 },
    );
  }

  return NextResponse.json(document);
}
