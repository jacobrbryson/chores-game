"use client";

import { useState } from "react";
import type React from "react";
import { Avatar } from "@/components/avatar";
import { ChoreCategoriesChip } from "@/components/chore-categories-chip";
import { CoinIcon } from "@/components/coin-icon";
import { EnumChip } from "@/components/enum-chip";

type ChoreCategory = {
  id: string;
  name: string;
  color: string;
};

type ChoreListCardChore = {
  id: string;
  title: string;
  status: string;
  choreType?: string;
  assigneeName: string;
  assigneeAvatarId?: string;
  assigneeAvatarPhotoUrl?: string;
  assigneePrimaryColor?: string;
  dueDate: string;
  categories?: ChoreCategory[];
  completedAt?: string;
  coinValue: number;
  requireApproval?: boolean;
};

type ChoreListCardProps = {
  chore: ChoreListCardChore;
  checked: boolean;
  selectable: boolean;
  disabled: boolean;
  statusLabel: string;
  statusTone: "blue" | "green" | "rose" | "slate";
  completedDate: string;
  displayedCoinValue: string;
  coinTooltip?: string;
  actionSlot?: React.ReactNode;
  approvalSlot?: React.ReactNode;
  onCheckedChange: (checked: boolean) => void;
};

export function ChoreListCard({
  chore,
  checked,
  selectable,
  disabled,
  statusLabel,
  statusTone,
  completedDate,
  displayedCoinValue,
  coinTooltip,
  actionSlot,
  approvalSlot,
  onCheckedChange,
}: ChoreListCardProps) {
  const awaitingApproval = chore.status === "Submitted" && Boolean(chore.requireApproval);
  const [expanded, setExpanded] = useState(false);

  return (
    <article
      className={[
        "rounded-2xl border bg-white px-4 py-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md",
        awaitingApproval ? "border-amber-300 ring-2 ring-amber-100" : "border-slate-200",
      ].join(" ")}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            aria-label={`Select chore ${chore.title}`}
            checked={checked}
            disabled={!selectable || disabled}
            onChange={(event) => onCheckedChange(event.target.checked)}
            onClick={(event) => event.stopPropagation()}
            className="h-5 w-5 rounded border-slate-300 text-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
          />
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}>
            <Avatar
              size={40}
              name={chore.assigneeName || "Assignee"}
              avatarId={chore.assigneeAvatarId}
              photoUrl={chore.assigneeAvatarPhotoUrl}
              primaryColor={chore.assigneePrimaryColor || undefined}
              secondaryColor={chore.assigneePrimaryColor || undefined}
              fallbackColor={chore.assigneePrimaryColor ? "#ffffff" : undefined}
              ariaHidden
              referrerPolicy="no-referrer"
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-base font-black text-slate-900">{chore.title}</h2>
                <EnumChip label={statusLabel} tone={statusTone} />
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-3 text-sm font-bold text-slate-600">
                <span className="inline-flex items-center gap-1 text-amber-700" title={coinTooltip}>
                  {displayedCoinValue === "-" ? null : <CoinIcon size={15} />}
                  <span>{displayedCoinValue}</span>
                </span>
                <span>{expanded ? "Hide details" : "Show details"}</span>
              </div>
            </div>
            <span className="text-lg font-black leading-none text-slate-400" aria-hidden="true">
              {expanded ? "v" : ">"}
            </span>
          </button>
          {actionSlot ? (
            <div className="shrink-0" onClick={(event) => event.stopPropagation()}>
              {actionSlot}
            </div>
          ) : null}
        </div>

        {expanded ? (
          <div className="ml-8 border-t border-slate-100 pt-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Meta label="Assignee" value={chore.assigneeName || "-"} />
              <Meta label="Due" value={chore.dueDate || "-"} />
              <Meta label="Completed" value={completedDate} />
              <div className="rounded-xl bg-slate-50 px-3 py-2">
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Categories</p>
                <div className="mt-1">
                  <ChoreCategoriesChip categories={chore.categories ?? []} />
                </div>
              </div>
            </div>
            {approvalSlot ? <div className="mt-4">{approvalSlot}</div> : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2">
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-bold text-slate-800">{value}</p>
    </div>
  );
}
