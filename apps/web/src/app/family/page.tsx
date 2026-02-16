"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { FamilySummaryResponse } from "@/lib/family/types";

export default function FamilyPage() {
  const [summary, setSummary] = useState<FamilySummaryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadSummary() {
      setIsLoading(true);
      setError("");
      try {
        const response = await fetch("/api/family/summary", { cache: "no-store" });
        if (!response.ok) {
          const body = (await response.json()) as { error?: string };
          throw new Error(body.error ?? `SUMMARY_HTTP_${response.status}`);
        }
        const payload = (await response.json()) as FamilySummaryResponse;
        setSummary(payload);
      } catch (loadError) {
        const message =
          loadError instanceof Error ? loadError.message : "summary_unavailable";
        setError(message);
      } finally {
        setIsLoading(false);
      }
    }

    void loadSummary();
  }, []);

  const members = useMemo(() => summary?.members ?? [], [summary]);

  return (
    <div className="shell">
      <div className="container">
        <main className="panel family-page">
          <Link href="/" className="family-back-link">
            Back
          </Link>
          <h1>Family Members</h1>
          {isLoading ? <p className="small">Loading family members...</p> : null}
          {!isLoading && error ? (
            <p className="small family-error">Could not load members: {error}</p>
          ) : null}
          {!isLoading && !error ? (
            <>
              {summary?.pendingInvite ? (
                <p className="small">
                  Invitation is pending acceptance. Go back to the home dashboard to accept it.
                </p>
              ) : null}
              {!summary?.pendingInvite ? (
                <>
              <p className="small family-page-subhead">
                {members.length} member{members.length === 1 ? "" : "s"}
              </p>
              <div className="family-table-wrap">
                <table className="family-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Status</th>
                      <th>Last Sign In</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.length === 0 ? (
                      <tr>
                        <td colSpan={5}>No family members found.</td>
                      </tr>
                    ) : (
                      members.map((member) => (
                        <tr key={member.id}>
                          <td>{member.name}</td>
                          <td>{member.email || "-"}</td>
                          <td>{member.role}</td>
                          <td>{member.status}</td>
                          <td>
                            {member.id === summary?.viewerUid ||
                            member.uid === summary?.viewerUid
                              ? "-"
                              : member.lastSignInAt
                              ? new Date(member.lastSignInAt).toLocaleString()
                              : "-"}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
                </>
              ) : null}
            </>
          ) : null}
        </main>
      </div>
    </div>
  );
}
