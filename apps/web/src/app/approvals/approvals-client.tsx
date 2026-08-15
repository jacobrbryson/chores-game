"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Alert } from "@/components/alert";
import { Button } from "@/components/button";
import { CoinIcon } from "@/components/coin-icon";
import { FamilyMemberAvatar } from "@/components/family-member-avatar";
import { ModalShell } from "@/components/modal-shell";
import { useLocale } from "@/components/locale-provider";
import { RESPONSIBILITY_PILLAR_EMOJI } from "@/lib/responsibility/types";
import {
  APPROVAL_COIN_QUICK_VALUES as COIN_QUICK_VALUES,
  approvalAssigneeIds,
  defaultCoinsByAssignee,
  groupApprovalsByChild,
  isCoinValueHidden,
  needsCoinAssignment,
  resolveApprovalChoreType,
  splitForApproveAll,
  summarizeApprovals,
  trackApproval,
  type ApprovalChore,
  type ApprovalGroup,
} from "@/lib/approvals/inbox";
import { useApprovalActions } from "@/lib/approvals/use-approval-actions";
import { useApprovalInbox } from "@/lib/approvals/use-approval-inbox";

type SuccessSummary = {
  count: number;
  perChild: Array<{ name: string; coins: number }>;
};

function formatRelativeTime(value: string | undefined, locale: string, fallback: string) {
  if (!value) {
    return fallback;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  const diffMs = parsed - Date.now();
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const divisions: Array<{ amount: number; unit: Intl.RelativeTimeFormatUnit }> = [
    { amount: 60, unit: "second" },
    { amount: 60, unit: "minute" },
    { amount: 24, unit: "hour" },
    { amount: 7, unit: "day" },
    { amount: 4.34524, unit: "week" },
    { amount: 12, unit: "month" },
    { amount: Number.POSITIVE_INFINITY, unit: "year" },
  ];
  let duration = diffMs / 1000;
  for (const division of divisions) {
    if (Math.abs(duration) < division.amount) {
      return formatter.format(Math.round(duration), division.unit);
    }
    duration /= division.amount;
  }
  return fallback;
}

export default function ApprovalsClient() {
  const { t, locale } = useLocale();
  // Singular/plural key selector (the translator has no ICU plural support).
  const tc = (base: string, count: number, extra?: Record<string, string | number>) =>
    t(`${base}${count === 1 ? "One" : "Other"}`, { count, ...(extra ?? {}) });
  const router = useRouter();
  const searchParams = useSearchParams();
  const { chores, directory, viewerRole, loading, error: loadError, reload } = useApprovalInbox();
  const { busy, error: actionError, setError, approveImmediate, approveWithPayouts, approveAll, reject } =
    useApprovalActions();

  const [successSummary, setSuccessSummary] = useState<SuccessSummary | null>(null);
  const [pendingRejectChore, setPendingRejectChore] = useState<ApprovalChore | null>(null);
  const [rejectFeedback, setRejectFeedback] = useState("");

  // Coin-review queue: chores that need a coin value entered before approval. The
  // front item is shown in the modal; approving pops it. A queue can be a single
  // chore (manual Approve) or the full needs-coins set from Approve All.
  const [coinQueue, setCoinQueue] = useState<ApprovalChore[]>([]);
  const [coinsByAssignee, setCoinsByAssignee] = useState<Record<string, number>>({});
  const coinQueueIsApproveAll = useRef(false);
  const approveAllBaseRef = useRef<{ earned: Map<string, number>; count: number } | null>(null);
  const queueEarnedRef = useRef<Map<string, number>>(new Map());
  const queueApprovedCountRef = useRef(0);
  const autoApproveAllTriggered = useRef(false);

  const familyLabel = t("approvals.familyBucket");
  const groups = useMemo(
    () => groupApprovalsByChild(chores, directory, familyLabel),
    [chores, directory, familyLabel],
  );
  const summary = useMemo(() => summarizeApprovals(groups), [groups]);
  const choreById = useMemo(() => new Map(chores.map((c) => [c.id, c] as const)), [chores]);
  const childNameByKey = useMemo(
    () => new Map(groups.map((group) => [group.key, group.name] as const)),
    [groups],
  );
  const directoryNameByKey = useMemo(
    () => new Map(directory.map((entry) => [entry.id, entry.name] as const)),
    [directory],
  );

  const resolveChildName = useCallback(
    (chore: ApprovalChore) => {
      if (chore.assigneeScope === "family") {
        return familyLabel;
      }
      const key = chore.assigneeId || chore.assigneeIds?.[0] || "";
      return directoryNameByKey.get(key) || childNameByKey.get(key) || chore.assigneeName;
    },
    [childNameByKey, directoryNameByKey, familyLabel],
  );

  const currentCoinChore = coinQueue[0] ?? null;

  // Reset the per-assignee coin inputs whenever the front of the coin queue changes.
  useEffect(() => {
    if (currentCoinChore) {
      setCoinsByAssignee(defaultCoinsByAssignee(currentCoinChore));
    }
  }, [currentCoinChore]);

  // Players never see this page; redirect them home once role resolves.
  useEffect(() => {
    if (viewerRole === "player") {
      router.replace("/");
    }
  }, [viewerRole, router]);

  // Analytics: page opened.
  useEffect(() => {
    trackApproval("approval_inbox_opened");
  }, []);

  function addEarned(target: Map<string, number>, name: string, coins: number) {
    target.set(name, (target.get(name) ?? 0) + Math.max(0, Math.trunc(coins || 0)));
  }

  function buildSummary(earned: Map<string, number>, count: number): SuccessSummary {
    return {
      count,
      perChild: Array.from(earned.entries()).map(([name, coins]) => ({ name, coins })),
    };
  }

  const handleApproveOne = useCallback(
    async (chore: ApprovalChore) => {
      if (busy) {
        return;
      }
      setSuccessSummary(null);
      if (needsCoinAssignment(chore)) {
        coinQueueIsApproveAll.current = false;
        approveAllBaseRef.current = null;
        queueEarnedRef.current = new Map();
        queueApprovedCountRef.current = 0;
        setCoinQueue([chore]);
        return;
      }
      trackApproval("approval_inbox_approve", { choreId: chore.id });
      const ok = await approveImmediate(chore.id);
      if (ok) {
        setSuccessSummary(buildSummary(new Map([[resolveChildName(chore), chore.coinValue]]), 1));
        await reload({ silent: true });
      }
    },
    [busy, approveImmediate, reload, resolveChildName],
  );

  const handleApproveAll = useCallback(async () => {
    if (busy) {
      return;
    }
    setSuccessSummary(null);
    trackApproval("approval_inbox_approve_all");
    const { immediate, needsCoins } = splitForApproveAll(chores);
    const earned = new Map<string, number>();
    let count = 0;
    if (immediate.length > 0) {
      const result = await approveAll(immediate.map((c) => c.id));
      for (const id of result.succeeded) {
        const c = choreById.get(id);
        if (!c) continue;
        addEarned(earned, resolveChildName(c), c.coinValue);
        count += 1;
      }
    }
    if (needsCoins.length > 0) {
      // Hand the remaining chores to the coin-review queue; the summary is shown
      // once the queue drains so no chore is approved with a silent zero value.
      coinQueueIsApproveAll.current = true;
      approveAllBaseRef.current = { earned, count };
      queueEarnedRef.current = new Map();
      queueApprovedCountRef.current = 0;
      setCoinQueue(needsCoins);
      return;
    }
    if (count > 0) {
      setSuccessSummary(buildSummary(earned, count));
    }
    await reload({ silent: true });
  }, [busy, chores, approveAll, choreById, reload, resolveChildName]);

  // Auto-start Approve All when arriving from the dashboard card's "Approve All".
  useEffect(() => {
    if (
      searchParams.get("approveAll") === "1" &&
      !autoApproveAllTriggered.current &&
      !loading &&
      viewerRole === "admin" &&
      chores.length > 0
    ) {
      autoApproveAllTriggered.current = true;
      void handleApproveAll();
    }
  }, [searchParams, loading, viewerRole, chores.length, handleApproveAll]);

  async function onConfirmCoinApproval() {
    if (!currentCoinChore || busy) {
      return;
    }
    const ids = approvalAssigneeIds(currentCoinChore);
    const payouts = ids.map((assigneeId) => ({
      assigneeId,
      coinValue: Math.max(0, Math.trunc(Number(coinsByAssignee[assigneeId]) || 0)),
    }));
    trackApproval("approval_inbox_approve", { choreId: currentCoinChore.id, withCoins: true });
    const ok = await approveWithPayouts(currentCoinChore.id, payouts);
    if (!ok) {
      return;
    }
    const total = payouts.reduce((sum, payout) => sum + payout.coinValue, 0);
    addEarned(queueEarnedRef.current, resolveChildName(currentCoinChore), total);
    queueApprovedCountRef.current += 1;
    const rest = coinQueue.slice(1);
    setCoinQueue(rest);
    if (rest.length === 0) {
      if (coinQueueIsApproveAll.current) {
        // Merge the immediate-batch totals with the coins entered during the queue.
        const base = approveAllBaseRef.current ?? { earned: new Map<string, number>(), count: 0 };
        const merged = new Map(base.earned);
        for (const [name, coins] of queueEarnedRef.current.entries()) {
          addEarned(merged, name, coins);
        }
        setSuccessSummary(buildSummary(merged, base.count + queueApprovedCountRef.current));
      } else {
        // Single manual coin approval — show its own small celebration.
        setSuccessSummary(buildSummary(queueEarnedRef.current, queueApprovedCountRef.current));
      }
      coinQueueIsApproveAll.current = false;
      approveAllBaseRef.current = null;
      await reload({ silent: true });
    }
  }

  function onCancelCoinApproval() {
    setCoinQueue([]);
    coinQueueIsApproveAll.current = false;
    approveAllBaseRef.current = null;
    queueEarnedRef.current = new Map();
  }

  async function onConfirmReject() {
    if (!pendingRejectChore || busy) {
      return;
    }
    trackApproval("approval_inbox_reject", { choreId: pendingRejectChore.id });
    const ok = await reject(pendingRejectChore.id, rejectFeedback.trim());
    if (ok) {
      setPendingRejectChore(null);
      setRejectFeedback("");
      await reload({ silent: true });
    }
  }

  if (viewerRole === "player") {
    return null;
  }

  const headerError = actionError || loadError;

  return (
    <div className="approvals-page">
      <header className="approvals-header">
        <div>
          <h1 className="approvals-title">{t("approvals.page.title")}</h1>
          <p className="approvals-subtitle">{tc("approvals.page.waiting", summary.total)}</p>
        </div>
        {summary.total > 0 ? (
          <div className="approvals-header-actions">
            <Button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                const first = document.querySelector(".approval-review-card");
                first?.scrollIntoView({ behavior: "smooth", block: "center" });
              }}>
              {t("approvals.actions.reviewIndividually")}
            </Button>
            <Button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void handleApproveAll()}>
              {busy ? t("approvals.actions.approving") : t("approvals.actions.approveAll")}
            </Button>
          </div>
        ) : null}
      </header>

      {headerError ? (
        <Alert tone="error" className="mb-4">
          {t("approvals.errors.generic")}
        </Alert>
      ) : null}

      {successSummary ? (
        <Alert tone="success" className="mb-4">
          <p className="font-semibold">
            🎉 {tc("approvals.card.approvedTitle", successSummary.count)}
          </p>
          <ul className="approvals-success-list">
            {successSummary.perChild.map((child) => (
              <li key={child.name}>
                {t("approvals.card.childEarned", { name: child.name })}{" "}
                <span className="approval-card-coins">
                  <CoinIcon size={14} /> {child.coins}
                </span>
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {loading && chores.length === 0 ? (
        <p className="approvals-loading">{t("approvals.page.loading")}</p>
      ) : summary.total === 0 ? (
        <section className="approvals-empty" aria-live="polite">
          <p className="approvals-empty-title">🎉 {t("approvals.empty.title")}</p>
          <p className="approvals-empty-body">{t("approvals.empty.body")}</p>
        </section>
      ) : (
        <div className="approvals-groups">
          {groups.map((group) => (
            <ApprovalGroupSection
              key={group.key}
              group={group}
              locale={locale}
              t={t}
              busy={busy}
              onApprove={(chore) => void handleApproveOne(chore)}
              onReject={(chore) => {
                setPendingRejectChore(chore);
                setRejectFeedback("");
                setError("");
              }}
            />
          ))}
        </div>
      )}

      {/* Coin-selection modal (See & Do / multi-assignee chores). */}
      <ModalShell open={Boolean(currentCoinChore)} onRequestClose={onCancelCoinApproval}>
        <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-2xl">
          {currentCoinChore ? (
            <>
              <h3 className="text-lg font-bold text-slate-800">
                {t("approvals.coinModal.title")}
              </h3>
              <p className="mb-1 mt-2 text-sm text-slate-600">
                {t("approvals.coinModal.completedBy", {
                  name: resolveChildName(currentCoinChore),
                })}
              </p>
              <p className="mb-3 text-base font-semibold text-slate-800">
                {currentCoinChore.title}
              </p>
              {coinQueue.length > 1 ? (
                <p className="mb-3 text-xs font-medium text-slate-500">
                  {t("approvals.coinModal.remaining", { count: coinQueue.length })}
                </p>
              ) : null}
              <p className="mb-2 text-sm text-slate-600">{t("approvals.coinModal.prompt")}</p>
              <div className="mb-3 flex flex-wrap gap-2">
                {COIN_QUICK_VALUES.map((value) => (
                  <Button
                    key={value}
                    type="button"
                    className="btn btn-secondary"
                    onClick={() =>
                      setCoinsByAssignee((current) => {
                        const next: Record<string, number> = { ...current };
                        for (const id of approvalAssigneeIds(currentCoinChore)) {
                          next[id] = value;
                        }
                        return next;
                      })
                    }>
                    <CoinIcon size={14} /> {value}
                  </Button>
                ))}
              </div>
              <div className="mb-4 flex flex-col gap-2">
                {approvalAssigneeIds(currentCoinChore).map((assigneeId) => (
                  <label
                    key={assigneeId}
                    className="flex items-center justify-between gap-3 rounded-md border border-slate-200 p-2">
                    <span className="text-sm text-slate-700">
                      {directoryNameByKey.get(assigneeId) || assigneeId}
                    </span>
                    <span className="relative inline-flex items-center">
                      <span className="pointer-events-none absolute left-2 inline-flex items-center text-amber-500">
                        <CoinIcon size={14} />
                      </span>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={coinsByAssignee[assigneeId] ?? 0}
                        onChange={(event) =>
                          setCoinsByAssignee((current) => ({
                            ...current,
                            [assigneeId]: Math.max(0, Math.trunc(Number(event.target.value) || 0)),
                          }))
                        }
                        className="h-9 w-24 rounded-md border border-slate-300 pl-7 pr-2 py-1 text-right text-slate-800"
                      />
                    </span>
                  </label>
                ))}
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busy}
                  onClick={onCancelCoinApproval}>
                  {t("common.actions.cancel")}
                </Button>
                <Button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => void onConfirmCoinApproval()}>
                  {busy ? t("approvals.actions.approving") : t("approvals.actions.approve")}
                </Button>
              </div>
            </>
          ) : null}
        </div>
      </ModalShell>

      {/* Reject modal. */}
      <ModalShell
        open={Boolean(pendingRejectChore)}
        onRequestClose={() => setPendingRejectChore(null)}>
        <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-2xl">
          {pendingRejectChore ? (
            <>
              <h3 className="text-lg font-bold text-slate-800">
                {t("approvals.rejectModal.title")}
              </h3>
              <p className="mb-3 mt-2 text-sm text-slate-600">
                {t("approvals.rejectModal.prompt", { title: pendingRejectChore.title })}
              </p>
              <label className="mb-4 flex flex-col gap-1.5">
                <span className="text-sm font-medium text-slate-700">
                  {t("approvals.rejectModal.feedback")}
                </span>
                <textarea
                  rows={4}
                  value={rejectFeedback}
                  onChange={(event) => setRejectFeedback(event.target.value)}
                  placeholder={t("approvals.rejectModal.feedbackPlaceholder")}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-slate-800 placeholder:text-slate-400"
                />
              </label>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busy}
                  onClick={() => setPendingRejectChore(null)}>
                  {t("common.actions.cancel")}
                </Button>
                <Button
                  type="button"
                  className="btn btn-danger"
                  disabled={busy}
                  onClick={() => void onConfirmReject()}>
                  {busy ? t("approvals.actions.rejecting") : t("approvals.actions.reject")}
                </Button>
              </div>
            </>
          ) : null}
        </div>
      </ModalShell>
    </div>
  );
}

type Translator = (key: string, params?: Record<string, string | number>) => string;

function ApprovalGroupSection({
  group,
  locale,
  t,
  busy,
  onApprove,
  onReject,
}: {
  group: ApprovalGroup;
  locale: string;
  t: Translator;
  busy: boolean;
  onApprove: (chore: ApprovalChore) => void;
  onReject: (chore: ApprovalChore) => void;
}) {
  return (
    <section className="approval-group">
      <div className="approval-group-header">
        <FamilyMemberAvatar
          size={36}
          borderWidth={1}
          name={group.name}
          avatarId={group.avatarId}
          avatarPhotoUrl={group.avatarPhotoUrl}
          isFamily={group.isFamily}
          ariaHidden
        />
        <span className="approval-group-name">{group.name}</span>
        <span className="approval-group-count">
          {t(
            `approvals.group.count${group.chores.length === 1 ? "One" : "Other"}`,
            { count: group.chores.length },
          )}
        </span>
      </div>
      <ul className="approval-review-list">
        {group.chores.map((chore) => (
          <li key={chore.id} className="approval-review-card">
            <div className="approval-review-main">
              <p className="approval-review-title">✓ {chore.title}</p>
              <p className="approval-review-meta">
                {formatRelativeTime(chore.completedAt, locale, t("approvals.review.justNow"))}
                {" · "}
                {t(`approvals.choreType.${resolveApprovalChoreType(chore)}`)}
              </p>
              <div className="approval-review-tags">
                {chore.responsibilityPillar ? (
                  <span className="approval-review-pillar">
                    <span aria-hidden="true">
                      {RESPONSIBILITY_PILLAR_EMOJI[chore.responsibilityPillar]}
                    </span>{" "}
                    {t(`responsibility.pillars.${chore.responsibilityPillar}`)}
                  </span>
                ) : null}
                <span className="approval-review-coins">
                  <CoinIcon size={14} />{" "}
                  {isCoinValueHidden(chore) ? "—" : chore.coinValue}
                </span>
              </div>
            </div>
            <div className="approval-review-actions">
              <Button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => onApprove(chore)}>
                {needsCoinAssignment(chore)
                  ? t("approvals.actions.approveWithEllipsis")
                  : t("approvals.actions.approve")}
              </Button>
              <Button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => onReject(chore)}>
                {t("approvals.actions.reject")}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
