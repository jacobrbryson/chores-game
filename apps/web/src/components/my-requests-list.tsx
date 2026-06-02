"use client";

import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Alert } from "@/components/alert";
import { AppMenu } from "@/components/app-menu";
import { Button } from "@/components/button";
import { EnumChip } from "@/components/enum-chip";
import { useLocale } from "@/components/locale-provider";
import { MenuActionButton } from "@/components/menu-action-button";
import { ModalShell } from "@/components/modal-shell";
import { SupportRequestDialog } from "@/components/support-request-dialog";
import { showToast } from "@/components/toast";
import type {
  SupportRequestSeverity,
  SupportRequestStatus,
  SupportRequestType,
} from "@/lib/support/requests";

type MyRequestItem = {
  id: string;
  type: SupportRequestType;
  subject: string;
  description: string;
  severity: SupportRequestSeverity | null;
  category: string;
  status: SupportRequestStatus;
  appliedChangeLogDate: string;
  createdAt: string;
};

type MyRequestsResponse = {
  requests: MyRequestItem[];
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

type DialogState =
  | { mode: "create"; type: SupportRequestType }
  | { mode: "edit"; request: MyRequestItem }
  | null;

const PAGE_SIZE = 20;

function MenuItemIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true">
      {children}
    </svg>
  );
}

const editIcon = (
  <MenuItemIcon>
    <path d="M12.75 4.75 15.25 7.25" />
    <path d="M4.75 15.25H7.5l7.75-7.75-2.5-2.5L5 12.75v2.5Z" />
  </MenuItemIcon>
);

const cancelIcon = (
  <MenuItemIcon>
    <circle cx="10" cy="10" r="6.25" />
    <path d="M5.9 5.9l8.2 8.2" />
  </MenuItemIcon>
);

function formatDateTime(value: string, locale: string) {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return "-";
  }
  return new Date(parsed).toLocaleString(locale);
}

function statusTone(status: SupportRequestStatus) {
  switch (status) {
    case "new":
      return "blue";
    case "triaged":
      return "indigo";
    case "planned":
      return "violet";
    case "in_progress":
      return "amber";
    case "declined":
    case "duplicate":
      return "rose";
    case "done":
      return "green";
    default:
      return "slate";
  }
}

function severityTone(severity: SupportRequestSeverity) {
  if (severity === "high") {
    return "rose";
  }
  if (severity === "medium") {
    return "amber";
  }
  return "teal";
}

// Edit/cancel are only offered while the request is still actionable by the user.
function isEditable(status: SupportRequestStatus) {
  return status === "new";
}

export function MyRequestsList() {
  const { locale, t } = useLocale();
  const [items, setItems] = useState<MyRequestItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [menuKey, setMenuKey] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<MyRequestItem | null>(null);
  const [cancelPending, setCancelPending] = useState(false);
  const [cancelError, setCancelError] = useState("");

  const loadRequests = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
      const response = await fetch(`/api/support/requests/my?${params.toString()}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `MY_REQUESTS_HTTP_${response.status}`);
      }
      const payload = (await response.json()) as MyRequestsResponse;
      const requests = payload.requests ?? [];
      setItems(requests);
      setPage(payload.pagination?.page ?? page);
      setTotal(payload.pagination?.total ?? requests.length);
      setTotalPages(payload.pagination?.totalPages ?? 1);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "support_requests_unavailable");
    } finally {
      setIsLoading(false);
    }
  }, [page]);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  function refreshAfterMutation() {
    if (page === 1) {
      void loadRequests();
    } else {
      setPage(1);
    }
  }

  function localizedError(code: string) {
    const key = `support.errors.${code}`;
    const message = t(key);
    return message === key ? t("support.errors.generic") : message;
  }

  async function confirmCancel() {
    if (!cancelTarget || cancelPending) {
      return;
    }
    setCancelPending(true);
    setCancelError("");
    try {
      const response = await fetch(`/api/support/requests/${encodeURIComponent(cancelTarget.id)}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `SUPPORT_REQUEST_CANCEL_HTTP_${response.status}`);
      }
      setCancelTarget(null);
      showToast(t("myRequests.cancelToast"), "success");
      refreshAfterMutation();
    } catch (cancelErr) {
      setCancelError(localizedError(cancelErr instanceof Error ? cancelErr.message : "generic"));
    } finally {
      setCancelPending(false);
    }
  }

  const dialogKey = dialog
    ? dialog.mode === "edit"
      ? `edit:${dialog.request.id}`
      : `create:${dialog.type}`
    : "closed";

  return (
    <section aria-label={t("myRequests.title")} className="flex flex-col gap-3">
      <div className="family-page-card-header">
        <div>
          <h2>{t("myRequests.title")}</h2>
          <p className="small family-page-subhead">{t("myRequests.subtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            className="btn btn-secondary"
            onClick={() => setDialog({ mode: "create", type: "bug" })}>
            {t("support.bug.menuLabel")}
          </Button>
          <Button
            type="button"
            className="btn btn-primary"
            onClick={() => setDialog({ mode: "create", type: "feature" })}>
            {t("support.feature.menuLabel")}
          </Button>
        </div>
      </div>

      {isLoading ? <p className="small">{t("myRequests.loading")}</p> : null}
      {!isLoading && error ? <Alert>{t("myRequests.loadError", { error })}</Alert> : null}
      {!isLoading && !error ? (
        items.length === 0 ? (
          <p className="small">{t("myRequests.empty")}</p>
        ) : (
          <>
            <div className="family-table-wrap">
              <table className="family-table my-requests-table">
                <thead>
                  <tr>
                    <th>{t("myRequests.columns.subject")}</th>
                    <th>{t("myRequests.columns.category")}</th>
                    <th>{t("myRequests.columns.severity")}</th>
                    <th>{t("myRequests.columns.status")}</th>
                    <th>{t("myRequests.columns.submitted")}</th>
                    <th className="family-table-actions-col">{t("myRequests.columns.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const editable = isEditable(item.status);
                    return (
                      <tr key={item.id}>
                        <td>
                          <div>{item.subject || "-"}</div>
                          <div className="mt-1">
                            <EnumChip
                              label={t(`support.type.${item.type}`)}
                              tone={item.type === "bug" ? "rose" : "violet"}
                            />
                          </div>
                        </td>
                        <td className="text-sm text-slate-700">
                          {item.category
                            ? (t(`support.categories.${item.category}`) !== `support.categories.${item.category}`
                                ? t(`support.categories.${item.category}`)
                                : item.category)
                            : <span className="text-slate-400">—</span>}
                        </td>
                        <td>
                          {item.severity ? (
                            <EnumChip
                              label={t(`support.severity.${item.severity}`)}
                              tone={severityTone(item.severity)}
                            />
                          ) : (
                            <span className="small">{t("myRequests.severityNone")}</span>
                          )}
                        </td>
                        <td>
                          <EnumChip
                            label={t(`support.status.${item.status}`)}
                            tone={statusTone(item.status)}
                          />
                        </td>
                        <td>{formatDateTime(item.createdAt, locale)}</td>
                        <td>
                          <AppMenu
                            open={menuKey === item.id}
                            onOpenChange={(next) => setMenuKey(next ? item.id : null)}
                            wrapperClassName="flex justify-end"
                            triggerClassName="btn btn-secondary member-action-btn"
                            triggerAriaLabel={t("myRequests.actionsAriaLabel")}
                            triggerTitle={t("myRequests.actionsAriaLabel")}
                            panelClassName="app-menu-panel family-action-dropdown"
                            trigger={<span className="text-lg leading-none">&#8943;</span>}>
                            {editable ? (
                              <MenuActionButton
                                fullWidth
                                leading={editIcon}
                                onClick={() => {
                                  setMenuKey(null);
                                  setDialog({ mode: "edit", request: item });
                                }}>
                                {t("myRequests.menu.edit")}
                              </MenuActionButton>
                            ) : null}
                            <MenuActionButton
                              fullWidth
                              leading={cancelIcon}
                              className="menu-action-link-danger"
                              onClick={() => {
                                setMenuKey(null);
                                setCancelError("");
                                setCancelTarget(item);
                              }}>
                              {t("myRequests.menu.cancel")}
                            </MenuActionButton>
                          </AppMenu>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="table-pager">
              <Button
                type="button"
                className="btn btn-secondary"
                disabled={page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}>
                {t("myRequests.pager.previous")}
              </Button>
              <span className="small">
                {t("myRequests.pager.pageOf", { page, totalPages, total })}
              </span>
              <Button
                type="button"
                className="btn btn-secondary"
                disabled={page >= totalPages}
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>
                {t("myRequests.pager.next")}
              </Button>
            </div>
          </>
        )
      ) : null}

      <SupportRequestDialog
        key={dialogKey}
        open={dialog !== null}
        mode={dialog?.mode ?? "create"}
        type={dialog ? (dialog.mode === "edit" ? dialog.request.type : dialog.type) : "bug"}
        requestId={dialog?.mode === "edit" ? dialog.request.id : undefined}
        initialValues={
          dialog?.mode === "edit"
            ? {
                subject: dialog.request.subject,
                description: dialog.request.description,
                severity: dialog.request.severity,
                category: dialog.request.category ?? "",
              }
            : undefined
        }
        onRequestClose={() => setDialog(null)}
        onSubmitted={refreshAfterMutation}
      />

      <ModalShell open={cancelTarget !== null} onRequestClose={() => setCancelTarget(null)}>
        <div className="family-modal-card w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-2xl">
          <div className="modal-dialog-title-row family-modal-title-row mb-3">
            <h3 className="family-modal-title">{t("myRequests.cancel.title")}</h3>
            <Button
              type="button"
              className="modal-close-button"
              onClick={() => setCancelTarget(null)}
              aria-label={t("common.actions.close")}
              title={t("common.actions.close")}>
              X
            </Button>
          </div>
          <div className="flex w-full flex-col gap-3">
            <p className="small">
              {t("myRequests.cancel.body", { subject: cancelTarget?.subject ?? "" })}
            </p>
            {cancelError ? <Alert>{cancelError}</Alert> : null}
            <div className="family-modal-actions">
              <Button
                type="button"
                className="btn btn-secondary"
                disabled={cancelPending}
                onClick={() => setCancelTarget(null)}>
                {t("myRequests.cancel.keep")}
              </Button>
              <Button
                type="button"
                className="btn btn-danger"
                disabled={cancelPending}
                onClick={() => void confirmCancel()}>
                {cancelPending ? t("myRequests.cancel.pending") : t("myRequests.cancel.confirm")}
              </Button>
            </div>
          </div>
        </div>
      </ModalShell>
    </section>
  );
}
