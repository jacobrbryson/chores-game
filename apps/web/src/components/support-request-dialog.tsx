"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Alert } from "@/components/alert";
import { Button } from "@/components/button";
import { useLocale } from "@/components/locale-provider";
import { ModalShell } from "@/components/modal-shell";
import { TailwindSelect, type TailwindSelectOption } from "@/components/tailwind-select";
import { showToast } from "@/components/toast";
import { CategorySelector } from "@/components/category-selector";
import {
  MAX_SUPPORT_DESCRIPTION_LENGTH,
  MAX_SUPPORT_SUBJECT_LENGTH,
  SUPPORT_REQUEST_SEVERITIES,
  validateSupportRequest,
  type SupportRequestSeverity,
  type SupportRequestType,
} from "@/lib/support/requests";

type SupportRequestDialogProps = {
  open: boolean;
  type: SupportRequestType;
  onRequestClose: () => void;
  // Called after a request is successfully created/updated (e.g. to refresh a list).
  onSubmitted?: () => void;
  // When "edit", the dialog updates an existing request instead of creating one.
  mode?: "create" | "edit";
  requestId?: string;
  initialValues?: {
    subject: string;
    description: string;
    severity: SupportRequestSeverity | null;
    category: string;
  };
};

function currentRoute() {
  if (typeof window === "undefined") {
    return "";
  }
  return `${window.location.pathname}${window.location.search}`;
}

export function SupportRequestDialog({
  open,
  type,
  onRequestClose,
  onSubmitted,
  mode = "create",
  requestId,
  initialValues,
}: SupportRequestDialogProps) {
  const { t } = useLocale();
  const isBug = type === "bug";
  const isEdit = mode === "edit";
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<SupportRequestSeverity>("medium");
  const [category, setCategory] = useState("");
  const [pageUrl, setPageUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const severityOptions = useMemo<TailwindSelectOption<SupportRequestSeverity>[]>(
    () =>
      SUPPORT_REQUEST_SEVERITIES.map((value) => ({
        value,
        label: t(`support.severity.${value}`),
      })),
    [t],
  );

  function resetForm() {
    setSubject("");
    setDescription("");
    setSeverity("medium");
    setCategory("");
    setError("");
  }

  useEffect(() => {
    if (!open) {
      return;
    }
    setError("");
    if (isEdit && initialValues) {
      setSubject(initialValues.subject);
      setDescription(initialValues.description);
      setSeverity(initialValues.severity ?? "medium");
      setCategory(initialValues.category ?? "");
    } else {
      resetForm();
      setPageUrl(currentRoute());
    }
    // initialValues identity is stable per dialog mount (keyed by caller).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function localizedError(code: string) {
    const key = `support.errors.${code}`;
    const message = t(key);
    // Fall back to a generic message when there is no specific locale entry.
    return message === key ? t("support.errors.generic") : message;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) {
      return;
    }

    const validation = validateSupportRequest({
      type,
      subject,
      description,
      severity: isBug ? severity : undefined,
      category,
    });
    if (!validation.ok) {
      setError(localizedError(validation.error));
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(
        isEdit ? `/api/support/requests/${encodeURIComponent(requestId ?? "")}` : "/api/support/requests",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            isEdit
              ? {
                  subject: validation.value.subject,
                  description: validation.value.description,
                  severity: validation.value.severity ?? undefined,
                  category: validation.value.category || undefined,
                }
              : {
                  type,
                  subject: validation.value.subject,
                  description: validation.value.description,
                  severity: validation.value.severity ?? undefined,
                  category: validation.value.category || undefined,
                  pageUrl,
                },
          ),
        },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `SUPPORT_REQUEST_HTTP_${response.status}`);
      }
      onRequestClose();
      resetForm();
      showToast(isEdit ? t("support.updateToast") : t("support.successToast"), "success");
      onSubmitted?.();
    } catch (submitError) {
      const code = submitError instanceof Error ? submitError.message : "generic";
      setError(localizedError(code));
    } finally {
      setSubmitting(false);
    }
  }

  const title = isEdit
    ? isBug
      ? t("support.bug.editTitle")
      : t("support.feature.editTitle")
    : isBug
      ? t("support.bug.title")
      : t("support.feature.title");
  const intro = isBug ? t("support.bug.intro") : t("support.feature.intro");

  return (
    <ModalShell open={open} onRequestClose={onRequestClose}>
      <form
        className="family-modal-card w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-2xl"
        onSubmit={onSubmit}>
        <div className="modal-dialog-title-row family-modal-title-row mb-3">
          <h3 className="family-modal-title">{title}</h3>
          <Button
            type="button"
            className="modal-close-button"
            onClick={onRequestClose}
            aria-label={t("common.actions.close")}
            title={t("common.actions.close")}>
            X
          </Button>
        </div>
        <div className="flex w-full flex-col gap-3">
          <p className="small">{intro}</p>

          <label className="flex w-full flex-col gap-1.5">
            <span className="text-sm font-medium text-slate-700">{t("support.subjectLabel")}</span>
            <input
              required
              value={subject}
              maxLength={MAX_SUPPORT_SUBJECT_LENGTH}
              onChange={(event) => setSubject(event.target.value)}
              placeholder={t("support.subjectPlaceholder")}
              className="h-10 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-800 placeholder:text-slate-400"
            />
          </label>

          {isBug ? (
            <label className="flex w-full flex-col gap-1.5">
              <span className="text-sm font-medium text-slate-700">{t("support.severityLabel")}</span>
              <TailwindSelect
                ariaLabel={t("support.severityLabel")}
                value={severity}
                onChange={(value) => setSeverity(value as SupportRequestSeverity)}
                options={severityOptions}
                className="w-full"
                buttonClassName="rounded-md border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
                menuClassName="border-slate-300"
              />
            </label>
          ) : null}

          <label className="flex w-full flex-col gap-1.5">
            <span className="text-sm font-medium text-slate-700">{t("support.categoryLabel")}</span>
            <CategorySelector
              type={type}
              value={category}
              onChange={setCategory}
              labelFor={(key) => t(`support.categories.${key}`)}
              selectClassName="h-10 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-800 placeholder:text-slate-400"
              inputClassName="h-10 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-800 placeholder:text-slate-400"
              placeholder={t("support.categoryPlaceholder")}
              customPlaceholder={t("support.categoryCustomPlaceholder")}
              customLabel={t("support.categoryLabel")}
            />
          </label>

          <label className="flex w-full flex-col gap-1.5">
            <span className="text-sm font-medium text-slate-700">{t("support.descriptionLabel")}</span>
            <textarea
              required
              rows={5}
              value={description}
              maxLength={MAX_SUPPORT_DESCRIPTION_LENGTH}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t("support.descriptionPlaceholder")}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-slate-800 placeholder:text-slate-400"
            />
          </label>

          {error ? <Alert>{error}</Alert> : null}

          <div className="family-modal-actions">
            <Button
              type="button"
              className="btn btn-secondary"
              disabled={submitting}
              onClick={onRequestClose}>
              {t("common.actions.cancel")}
            </Button>
            <Button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting
                ? t("support.submitting")
                : isEdit
                  ? t("support.submitUpdate")
                  : t("support.submit")}
            </Button>
          </div>
        </div>
      </form>
    </ModalShell>
  );
}
