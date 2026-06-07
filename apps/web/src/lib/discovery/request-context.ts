import { getViewerFamilyContext } from "@/lib/family/member-access";
import { resolveAppLocale } from "@/lib/locale";
import { buildViewerAliases } from "@/lib/discovery/visibility";
import type { DiscoveryViewerContext } from "@/lib/discovery/types";
import type { SessionUser } from "@/lib/auth/session";

// Resolves the discovery viewer context for the active (possibly switched-child)
// profile. Identity is taken from the signed-in session — never trust
// client-provided identity. The Firestore token is the authenticated caller's
// token; managed-child discovery writes are authorized by the family-admin rule.
export async function buildDiscoveryViewerContext(
  session: SessionUser,
  idToken: string,
): Promise<DiscoveryViewerContext> {
  const family = await getViewerFamilyContext(session.uid, session.email, idToken);
  const aliases = buildViewerAliases({
    uid: session.uid,
    memberId: session.memberId || family.viewerMember?.id,
    email: session.email,
    extra: [family.viewerMember?.uid ?? "", family.viewerMember?.email ?? ""],
  });
  return {
    uid: session.uid,
    memberId: session.memberId || family.viewerMember?.id || session.uid,
    email: session.email,
    viewerRole: family.viewerRole,
    familyId: family.familyId,
    idToken,
    locale: resolveAppLocale({
      sessionLocale: session.locale,
      memberLocale: family.viewerMember?.locale,
      familyLocale: family.familyLocale,
    }),
    aliases,
  };
}
