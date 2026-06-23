"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { connectFamilySocket, type FamilyActivityEvent } from "@/lib/ws";
import { shouldReloadFamilySummary } from "@/lib/ws/realtime-refresh";
import type { ApprovalChore, AssigneeDirectoryEntry } from "@/lib/approvals/inbox";

type ChoresApiResponse = {
  chores?: ApprovalChore[];
  assigneeDirectory?: AssigneeDirectoryEntry[];
  viewerRole?: "admin" | "player";
  wsAuthToken?: string;
};

export type ApprovalInboxState = {
  chores: ApprovalChore[];
  directory: AssigneeDirectoryEntry[];
  viewerRole: "admin" | "player" | null;
  loading: boolean;
  error: string;
  reload: (options?: { silent?: boolean }) => Promise<void>;
};

// Loads the family's awaiting-approval chores from the existing chores API and
// keeps them fresh over the family-activity websocket. Shared by the dashboard
// approval card, the /approvals page, and the nav-badge count so all three stay
// in sync without duplicating fetch/socket plumbing.
export function useApprovalInbox(): ApprovalInboxState {
  const [chores, setChores] = useState<ApprovalChore[]>([]);
  const [directory, setDirectory] = useState<AssigneeDirectoryEntry[]>([]);
  const [viewerRole, setViewerRole] = useState<"admin" | "player" | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const authTokenRef = useRef("");
  const requestSeqRef = useRef(0);

  const reload = useCallback(async (options?: { silent?: boolean }) => {
    const seq = ++requestSeqRef.current;
    if (!options?.silent) {
      setLoading(true);
    }
    try {
      const response = await fetch("/api/chores?status=needs_approval&limit=100", {
        cache: "no-store",
      });
      if (!response.ok) {
        if (seq === requestSeqRef.current) {
          setError(`approvals_http_${response.status}`);
        }
        return;
      }
      const payload = (await response.json()) as ChoresApiResponse;
      if (seq !== requestSeqRef.current) {
        return;
      }
      setChores(Array.isArray(payload.chores) ? payload.chores : []);
      setDirectory(Array.isArray(payload.assigneeDirectory) ? payload.assigneeDirectory : []);
      setViewerRole(payload.viewerRole ?? null);
      authTokenRef.current = payload.wsAuthToken?.trim() ?? authTokenRef.current;
      setError("");
    } catch {
      if (seq === requestSeqRef.current) {
        setError("approvals_unavailable");
      }
    } finally {
      if (seq === requestSeqRef.current && !options?.silent) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Subscribe once an auth token is available; resubscribe if it changes.
  useEffect(() => {
    const authToken = authTokenRef.current;
    if (!authToken) {
      return;
    }
    const socket = connectFamilySocket({ authToken });
    if (!socket) {
      return;
    }
    const onActivity = (event: FamilyActivityEvent) => {
      if (shouldReloadFamilySummary(event.type)) {
        void reload({ silent: true });
      }
    };
    socket.on("family:activity", onActivity);
    return () => {
      socket.off("family:activity", onActivity);
    };
    // authTokenRef.current is captured after the first successful load; viewerRole
    // flips from null on that same load, so depending on it re-runs the effect
    // exactly when the token becomes available.
  }, [reload, viewerRole]);

  return { chores, directory, viewerRole, loading, error, reload };
}
