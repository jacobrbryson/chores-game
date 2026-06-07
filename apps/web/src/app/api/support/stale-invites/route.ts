import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { isSupportAdmin } from "@/lib/support/access";
import { adminRunQuery } from "@/lib/firestore/admin";
import { documentIdFromName, readString, readTimestamp } from "@/lib/firestore/rest";

export const runtime = "nodejs";

function familyIdFromMemberName(name: string) {
  const match = name.match(/\/families\/([^/]+)\/members\//);
  return match?.[1] ?? "";
}

export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isSupportAdmin(session)) {
    return NextResponse.json({ error: "support_admin_required" }, { status: 403 });
  }

  try {
    const memberDocs = await adminRunQuery({
      from: [{ collectionId: "members", allDescendants: true }],
      limit: 2000,
    });

    const members = memberDocs.map((doc) => ({
      familyId: familyIdFromMemberName(doc.name),
      memberId: documentIdFromName(doc.name),
      email: readString(doc.fields, "email"),
      name: readString(doc.fields, "name"),
      status: readString(doc.fields, "status"),
      role: readString(doc.fields, "role"),
      createdAt: readTimestamp(doc.fields, "createdAt"),
      createdBy: readString(doc.fields, "createdBy"),
    }));

    // Build set of (familyId:email) pairs where an active member already exists
    const activeKeys = new Set<string>();
    for (const member of members) {
      if (member.status === "active" && member.email) {
        activeKeys.add(`${member.familyId}:${member.email.toLowerCase()}`);
      }
    }

    // Stale: invited record whose email has an active counterpart in the same family
    const staleInvites = members.filter(
      (member) =>
        member.status === "invited" &&
        member.email &&
        activeKeys.has(`${member.familyId}:${member.email.toLowerCase()}`),
    );

    return NextResponse.json({ staleInvites });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown";
    console.error("[SUPPORT_STALE_INVITES_ERROR]", reason.slice(0, 200));
    return NextResponse.json({ error: "stale_invites_unavailable" }, { status: 500 });
  }
}
