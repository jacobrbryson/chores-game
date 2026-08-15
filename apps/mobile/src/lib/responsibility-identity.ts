// Mobile loader for a member's Responsibility Pillar identities. Mirrors the
// self-fetching web identity components (identity-journey-widget.tsx and
// profile-identity-card.tsx) against the /api/v1 proxy. The selection rules
// themselves are shared — see @packages/core/responsibility-identity.
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { PillarIdentity } from "@packages/core";

type ProgressResponse = {
  progress?: { pillars?: PillarIdentity[] };
};

// Returns null until progress has loaded (or if it fails) so the identity
// surfaces can stay hidden rather than flashing an empty shell — the same
// best-effort behavior the web widgets use.
export function useResponsibilityIdentities(memberId?: string): PillarIdentity[] | null {
  const [identities, setIdentities] = useState<PillarIdentity[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const query = memberId ? `?memberId=${encodeURIComponent(memberId)}` : "";
    void apiFetch(`/responsibility/progress${query}`)
      .then((payload) => {
        if (cancelled) {
          return;
        }
        const pillars = (payload as ProgressResponse).progress?.pillars;
        if (Array.isArray(pillars)) {
          setIdentities(pillars);
        }
      })
      .catch(() => {
        // Best-effort — the identity surfaces stay hidden on failure.
      });
    return () => {
      cancelled = true;
    };
  }, [memberId]);

  return identities;
}

type IdentitiesResponse = {
  members?: Array<{ uid: string; identities: PillarIdentity[] }>;
};

// Every family member's identities in one read, keyed by player uid — for the
// selection tiles (switch account, kiosk) that show identity chips per member.
// Mirrors the batch fetch web's profile menu and kiosk entry do.
export function useFamilyResponsibilityIdentities(enabled = true): Record<string, PillarIdentity[]> {
  const [byUid, setByUid] = useState<Record<string, PillarIdentity[]>>({});

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let cancelled = false;
    void apiFetch("/responsibility/identities")
      .then((payload) => {
        if (cancelled) {
          return;
        }
        const next: Record<string, PillarIdentity[]> = {};
        for (const entry of (payload as IdentitiesResponse).members ?? []) {
          if (entry?.uid && Array.isArray(entry.identities)) {
            next[entry.uid] = entry.identities;
          }
        }
        setByUid(next);
      })
      .catch(() => {
        // Best-effort — tiles simply render without identity chips.
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return byUid;
}
