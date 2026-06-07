import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import { isSupportAdmin } from "@/lib/support/access";
import { adminDeleteDocument } from "@/lib/firestore/admin";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.uid) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isSupportAdmin(session)) {
    return NextResponse.json({ error: "support_admin_required" }, { status: 403 });
  }

  const body = (await request.json()) as { entity?: string; id?: string; familyId?: string };
  const { entity, id, familyId } = body;

  if (!entity || !id) {
    return NextResponse.json({ error: "missing_params" }, { status: 400 });
  }

  try {
    if (entity === "family") {
      await adminDeleteDocument(`families/${id}`);
    } else if (entity === "user") {
      await adminDeleteDocument(`users/${id}`);
    } else if (entity === "chore") {
      if (!familyId) {
        return NextResponse.json({ error: "missing_family_id" }, { status: 400 });
      }
      await adminDeleteDocument(`families/${familyId}/chores/${id}`);
    } else if (entity === "supportRequest") {
      // Only a support operator can actually delete a support request. End users
      // can only cancel (cancelledByUser), which keeps the record for support.
      if (!familyId) {
        return NextResponse.json({ error: "missing_family_id" }, { status: 400 });
      }
      await adminDeleteDocument(`families/${familyId}/supportRequests/${id}`);
    } else if (entity === "familyMember") {
      if (!familyId) {
        return NextResponse.json({ error: "missing_family_id" }, { status: 400 });
      }
      await adminDeleteDocument(`families/${familyId}/members/${id}`);
    } else {
      return NextResponse.json({ error: "invalid_entity" }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown";
    console.error("[SUPPORT_DELETE_ERROR]", reason.slice(0, 240));
    return NextResponse.json({ error: "delete_failed", message: reason }, { status: 500 });
  }
}
