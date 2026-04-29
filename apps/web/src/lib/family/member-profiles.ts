import type { FamilyAwardClaim } from "@/lib/family/award-claims";
import { listFamilyAwardClaims } from "@/lib/family/award-claims";
import { getDocument, listDocuments, readInteger, readString, readStringArray } from "@/lib/firestore/rest";
import {
  canViewerAccessFamilyMember,
  getViewerFamilyContext,
  resolveFamilyMemberByIdentifier,
  type FamilyResolvedMember,
  type ViewerRole,
} from "@/lib/family/member-access";
import {
  DEFAULT_COLOR_THEME_OPTION_ID,
  DEFAULT_CONFETTI_OPTION_ID,
  findColorThemeOptionById,
  findConfettiOptionById,
  findStoreOptionByValue,
  type ThemePalette,
} from "@/lib/store/catalog";
import { resolveMemberPrimaryColor } from "@/lib/theme/member-primary-color";
import { buildOwnedItemsSummary, type OwnedItemSummary } from "@/lib/items/owned-items";

export type FamilyMemberThemeSummary = {
  name: string;
  palette: ThemePalette;
  isDefault: boolean;
};

export type FamilyMemberConfettiSummary = {
  id: string;
  name: string;
  colors: string[];
  isDefault: boolean;
};

export type FamilyMemberProfileData = {
  familyId: string;
  familyName: string;
  viewerRole: ViewerRole;
  canManageAwards: boolean;
  member: FamilyResolvedMember;
  theme: FamilyMemberThemeSummary;
  confetti: FamilyMemberConfettiSummary;
  unclaimedAwards: FamilyAwardClaim[];
  claimedAwards: FamilyAwardClaim[];
  ownedItems: OwnedItemSummary[];
};

type LoadFamilyMemberProfileDataInput = {
  viewerUid: string;
  viewerEmail: string;
  memberIdentifier: string;
  idToken: string;
};

async function resolveEffectiveConfettiOptionId(
  member: FamilyResolvedMember,
  viewerUid: string,
  idToken: string,
) {
  const memberOptionId = member.selectedConfettiOptionId?.trim() ?? "";
  const memberOption = memberOptionId ? findConfettiOptionById(memberOptionId) : null;

  if (member.uid && member.uid === viewerUid) {
    try {
      const userDoc = await getDocument(`users/${member.uid}`, idToken);
      const userOptionId = readString(userDoc.fields, "selectedConfettiOptionId").trim();
      const userOption = userOptionId ? findConfettiOptionById(userOptionId) : null;
      if (userOption) {
        return userOption.id;
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "";
      if (!reason.includes("FIRESTORE_HTTP_404")) {
        throw error;
      }
    }
  }

  if (memberOption) {
    return memberOption.id;
  }

  return DEFAULT_CONFETTI_OPTION_ID;
}

function resolveOwnedOptionIds(fields: Parameters<typeof readStringArray>[0]) {
  const ownedOptionIds = new Set(readStringArray(fields, "ownedStoreOptionIds"));
  ownedOptionIds.add(DEFAULT_COLOR_THEME_OPTION_ID);
  ownedOptionIds.add(DEFAULT_CONFETTI_OPTION_ID);
  return ownedOptionIds;
}

function buildThemeSummary(member: FamilyResolvedMember): FamilyMemberThemeSummary {
  const defaultThemeOption = findColorThemeOptionById(DEFAULT_COLOR_THEME_OPTION_ID);
  const defaultPalette = defaultThemeOption?.theme ?? {
    primary: "#0072b2",
    secondary: "#56b4e9",
    tertiary: "#1b2a41",
  };
  const resolvedPrimaryColor = resolveMemberPrimaryColor(member.dashboardPrimaryColor);
  const matchedThemeOption = findStoreOptionByValue("customize_colors", resolvedPrimaryColor);
  if (matchedThemeOption?.theme) {
    return {
      name: matchedThemeOption.label,
      palette: matchedThemeOption.theme,
      isDefault: matchedThemeOption.id === DEFAULT_COLOR_THEME_OPTION_ID,
    };
  }

  return {
    name: defaultThemeOption?.label ?? "Cobalt Sky",
    palette: defaultPalette,
    isDefault: true,
  };
}

function buildConfettiSummary(selectedConfettiOptionId: string): FamilyMemberConfettiSummary {
  const activeConfettiOption =
    findConfettiOptionById(selectedConfettiOptionId) ??
    findConfettiOptionById(DEFAULT_CONFETTI_OPTION_ID);

  return {
    id: activeConfettiOption?.id ?? DEFAULT_CONFETTI_OPTION_ID,
    name: activeConfettiOption?.label ?? "No confetti",
    colors:
      activeConfettiOption?.confetti?.colors?.slice(0, 3) ?? ["#cbd5e1", "#94a3b8", "#e2e8f0"],
    isDefault:
      (activeConfettiOption?.id ?? DEFAULT_CONFETTI_OPTION_ID) === DEFAULT_CONFETTI_OPTION_ID,
  };
}

function compareClaimedAwards(a: FamilyAwardClaim, b: FamilyAwardClaim) {
  const aClaimedAt = a.claimedAt ? Date.parse(a.claimedAt) : 0;
  const bClaimedAt = b.claimedAt ? Date.parse(b.claimedAt) : 0;
  if (aClaimedAt !== bClaimedAt) {
    return bClaimedAt - aClaimedAt;
  }
  const aPurchasedAt = a.purchasedAt ? Date.parse(a.purchasedAt) : 0;
  const bPurchasedAt = b.purchasedAt ? Date.parse(b.purchasedAt) : 0;
  return bPurchasedAt - aPurchasedAt;
}

export async function loadFamilyMemberProfileData(
  input: LoadFamilyMemberProfileDataInput,
) {
  const familyContext = await getViewerFamilyContext(
    input.viewerUid,
    input.viewerEmail,
    input.idToken,
  );

  if (!familyContext.familyId) {
    return { kind: "family_not_found" as const };
  }

  const member = resolveFamilyMemberByIdentifier(
    familyContext.members,
    input.memberIdentifier,
  );
  if (!member) {
    return { kind: "member_not_found" as const };
  }

  if (
    !canViewerAccessFamilyMember(
      familyContext.viewerRole,
      input.viewerUid,
      input.viewerEmail,
      member,
    )
  ) {
    return { kind: "forbidden" as const };
  }

  const memberClaims = member.uid
    ? (await listFamilyAwardClaims(familyContext.familyId, input.idToken)).filter(
        (claim) => claim.purchaserUid === member.uid,
      )
    : [];
  const selectedConfettiOptionId = await resolveEffectiveConfettiOptionId(
    member,
    input.viewerUid,
    input.idToken,
  );
  let ownedItems: OwnedItemSummary[] = [];
  if (member.uid) {
    try {
      const [userDoc, inventoryDocs] = await Promise.all([
        getDocument(`users/${member.uid}`, input.idToken),
        listDocuments(`users/${member.uid}/inventory`, input.idToken, 500),
      ]);
      const inventoryByItemId = new Map<string, { quantity: number }>();
      for (const doc of inventoryDocs) {
        const itemId = readString(doc.fields, "itemId");
        if (!itemId) {
          continue;
        }
        inventoryByItemId.set(itemId, {
          quantity: Math.max(0, readInteger(doc.fields, "quantity")),
        });
      }
      ownedItems = buildOwnedItemsSummary({
        ownedOptionIds: resolveOwnedOptionIds(userDoc.fields),
        inventoryByItemId,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "";
      if (!reason.includes("FIRESTORE_HTTP_404")) {
        throw error;
      }
    }
  }

  return {
    kind: "ok" as const,
    profile: {
      familyId: familyContext.familyId,
      familyName: familyContext.familyName,
      viewerRole: familyContext.viewerRole,
      canManageAwards: familyContext.viewerRole === "admin",
      member,
      theme: buildThemeSummary(member),
      confetti: buildConfettiSummary(selectedConfettiOptionId),
      unclaimedAwards: memberClaims.filter((claim) => claim.status === "unclaimed"),
      claimedAwards: memberClaims
        .filter((claim) => claim.status === "claimed")
        .sort(compareClaimedAwards),
      ownedItems,
    } satisfies FamilyMemberProfileData,
  };
}
