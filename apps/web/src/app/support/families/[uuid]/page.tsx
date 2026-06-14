import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { parseSessionToken } from "@/lib/auth/session";
import { isSupportAdmin } from "@/lib/support/access";
import { loadSupportFamilyOverview } from "@/lib/support/family-overview";
import { SupportConsoleShell } from "@/components/support-console-shell";

function formatDate(value: string) {
  if (!value) return "Never";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function compactId(value: string) {
  if (!value) return "-";
  return value.length > 20 ? `${value.slice(0, 8)}...${value.slice(-8)}` : value;
}

function MetricCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string | number;
  detail: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{label}</div>
      <div className="mt-2 text-3xl font-bold text-slate-900">{value}</div>
      <div className="mt-1 text-sm text-slate-600">{detail}</div>
    </div>
  );
}

export default async function SupportFamilyOverviewPage({
  params,
}: {
  params: Promise<{ uuid: string }>;
}) {
  const cookieStore = await cookies();
  const session = parseSessionToken(cookieStore.get("session_user")?.value);
  if (!isSupportAdmin(session)) {
    redirect("/");
  }

  const { uuid } = await params;
  const overview = await loadSupportFamilyOverview(uuid);
  if (!overview) {
    notFound();
  }

  const activeWithCompletions = overview.members.filter((member) => member.weeklyCompletedChores > 0).length;

  return (
    <SupportConsoleShell activeModule="families" title="Families">
      <section className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="space-y-3">
          <Link href="/support/families" className="text-sm font-semibold text-sky-700 hover:text-sky-800">
            Back to families
          </Link>
          <div>
            <h1 className="text-3xl font-bold text-slate-950">{overview.family.name}</h1>
            <p className="mt-2 text-sm text-slate-600">
              Created: {formatDate(overview.family.createdAt)}
            </p>
          </div>
          <div className="grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
            <div>
              <span className="font-semibold text-slate-900">Default locale:</span>{" "}
              {overview.family.defaultLocale || "-"}
            </div>
            <div>
              <span className="font-semibold text-slate-900">Created by:</span>{" "}
              {overview.family.createdByEmail || compactId(overview.family.createdBy)}
            </div>
            <div>
              <span className="font-semibold text-slate-900">Last weekly highlights send:</span>{" "}
              {formatDate(overview.family.lastWeeklyHighlightSentAt)}
            </div>
            <div>
              <span className="font-semibold text-slate-900">Members:</span> {overview.family.totalMembers} total,{" "}
              {overview.family.activeMembers} active
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Weekly Chores"
          value={overview.metrics.choresCompleted}
          detail={`${overview.metrics.pendingApprovals} pending approvals`}
        />
        <MetricCard
          label="Weekly Coins"
          value={overview.metrics.coinsEarned}
          detail={`${overview.metrics.rewardsRedeemed} rewards redeemed`}
        />
        <MetricCard
          label="Weekly Progress"
          value={overview.metrics.questsCompleted + overview.metrics.achievementsUnlocked}
          detail={`${overview.metrics.questsCompleted} quests and ${overview.metrics.achievementsUnlocked} achievements`}
        />
        <MetricCard
          label="Active Helpers"
          value={activeWithCompletions}
          detail={
            overview.metrics.mostActiveHelperName
              ? `${overview.metrics.mostActiveHelperName} led with ${overview.metrics.mostActiveHelperCount}`
              : "No completed chores in this window"
          }
        />
      </section>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-xl font-bold text-slate-900">Family Members</h2>
            <p className="mt-1 text-sm text-slate-600">
              Weekly completions are counted from submitted or approved chores in the current seven-day window.
            </p>
          </div>
          <div className="overflow-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Member</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Weekly Completions</th>
                  <th className="px-4 py-3">Wallet</th>
                  <th className="px-4 py-3">Last Sign In</th>
                </tr>
              </thead>
              <tbody>
                {overview.members.map((member) => (
                  <tr key={member.id} className="border-t border-slate-100 align-top">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{member.name}</div>
                      <div className="text-xs text-slate-500">{member.email || compactId(member.uid || member.id)}</div>
                    </td>
                    <td className="px-4 py-3">{member.role}</td>
                    <td className="px-4 py-3">{member.status}</td>
                    <td className="px-4 py-3 font-semibold text-slate-900">{member.weeklyCompletedChores}</td>
                    <td className="px-4 py-3">{member.walletBalance}</td>
                    <td className="px-4 py-3">{formatDate(member.lastSignInAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-xl font-bold text-slate-900">Recent Highlights</h2>
            <p className="mt-1 text-sm text-slate-600">
              Latest family-visible activity from the same weekly recap window.
            </p>
          </div>
          <div className="p-5">
            {overview.metrics.recentHighlights.length ? (
              <div className="space-y-3">
                {overview.metrics.recentHighlights.map((highlight) => (
                  <article key={highlight.id} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="flex items-start gap-3">
                      <div className="text-xl leading-none">{highlight.icon}</div>
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-900">{highlight.title}</div>
                        <div className="mt-1 text-sm text-slate-600">{highlight.message || "No message"}</div>
                        <div className="mt-2 text-xs text-slate-500">{formatDate(highlight.createdAt)}</div>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500">No recent highlights for this family in the current weekly window.</p>
            )}
          </div>
        </section>
      </div>
    </SupportConsoleShell>
  );
}
