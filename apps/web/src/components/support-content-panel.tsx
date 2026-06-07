"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Alert } from "@/components/alert";
import { Button } from "@/components/button";
import { ModalShell } from "@/components/modal-shell";
import { EDITABLE_PUBLIC_CONTENT_TYPES, PUBLIC_CONTENT_STATUSES, PUBLIC_CONTENT_TYPES, type PublicContentStatus, type PublicContentType } from "@/lib/public-content/types";

type ContentRecord = {
  id: string;
  type: PublicContentType;
  status: PublicContentStatus;
  slug: string;
  title: string;
  shortDescription: string;
  body: string;
  category: string;
  tags: string[];
  ageRange: string;
  difficulty: string;
  estimatedMinutes: number;
  image: string;
  seoTitle: string;
  seoDescription: string;
  seoKeywords: string[];
  ogImage: string;
  canonicalPath: string;
  locale: string;
  updatedAt: string;
  publishedAt: string;
  voteCount: number;
  seoIssues: string[];
};

type SeoSummary = {
  total: number;
  published: number;
  byStatus: Record<string, number>;
  byType: Record<string, number>;
  missingSeoTitle: number;
  missingSeoDescription: number;
  missingImage: number;
  publishedPages: number;
  sitemapReady: boolean;
  robotsReady: boolean;
  structuredDataReady: boolean;
  recentPublished: ContentRecord[];
  needingReview: ContentRecord[];
};

type Payload = {
  content: ContentRecord[];
  seo: SeoSummary;
  pagination: { page: number; totalPages: number; total: number };
};

const EMPTY_FORM = {
  type: "guide",
  title: "",
  slug: "",
  shortDescription: "",
  body: "",
  category: "",
  tags: "",
  ageRange: "",
  difficulty: "",
  estimatedMinutes: "0",
  image: "",
  seoTitle: "",
  seoDescription: "",
  seoKeywords: "",
  ogImage: "",
  locale: "en-US",
};

function formatDate(value: string) {
  if (!value) return "-";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function seoLabel(issues: string[]) {
  const blocking = issues.filter((issue) => issue !== "not_published");
  return blocking.length ? `${blocking.length} issue${blocking.length === 1 ? "" : "s"}` : "Ready";
}

function contentToForm(record: ContentRecord) {
  return {
    type: record.type,
    title: record.title,
    slug: record.slug,
    shortDescription: record.shortDescription,
    body: record.body,
    category: record.category,
    tags: record.tags.join(", "),
    ageRange: record.ageRange,
    difficulty: record.difficulty,
    estimatedMinutes: String(record.estimatedMinutes || 0),
    image: record.image,
    seoTitle: record.seoTitle,
    seoDescription: record.seoDescription,
    seoKeywords: record.seoKeywords.join(", "),
    ogImage: record.ogImage,
    locale: record.locale || "en-US",
  };
}

export function SupportSeoPanel() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/support/content?limit=1", { cache: "no-store" })
      .then(async (response) => {
        const data = (await response.json()) as Payload & { error?: string };
        if (!response.ok) throw new Error(data.error || "SEO summary unavailable");
        setPayload(data);
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "SEO summary unavailable"));
  }, []);

  const seo = payload?.seo;
  return (
    <section className="flex flex-col gap-5">
      {error ? <Alert>{error}</Alert> : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Total content" value={seo?.total ?? 0} />
        <Metric label="Published" value={seo?.published ?? 0} />
        <Metric label="Missing SEO title" value={seo?.missingSeoTitle ?? 0} />
        <Metric label="Missing image / OG" value={seo?.missingImage ?? 0} />
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <SummaryCard title="Readiness">
          <Row label="Published pages" value={String(seo?.publishedPages ?? 0)} />
          <Row label="Sitemap ready" value={seo?.sitemapReady ? "Ready" : "Needs canonical paths"} />
          <Row label="Robots.txt ready" value={seo?.robotsReady ? "Ready" : "Not detected"} />
          <Row label="Structured data" value={seo?.structuredDataReady ? "Basic schemas enabled" : "Not implemented"} />
        </SummaryCard>
        <SummaryCard title="Lifecycle counts">
          {PUBLIC_CONTENT_STATUSES.map((status) => (
            <Row key={status} label={status} value={String(seo?.byStatus?.[status] ?? 0)} />
          ))}
        </SummaryCard>
      </div>
      <SummaryCard title="Counts by type">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {PUBLIC_CONTENT_TYPES.map((type) => (
            <Row key={type} label={type.replace("_", " ")} value={String(seo?.byType?.[type] ?? 0)} />
          ))}
        </div>
      </SummaryCard>
    </section>
  );
}

export function SupportContentPanel() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [missingSeo, setMissingSeo] = useState(false);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<ContentRecord | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ page: String(page), limit: "25" });
      if (type) params.set("type", type);
      if (status) params.set("status", status);
      if (query) params.set("q", query);
      if (missingSeo) params.set("missingSeo", "true");
      const response = await fetch(`/api/support/content?${params.toString()}`, { cache: "no-store" });
      const data = (await response.json()) as Payload & { error?: string };
      if (!response.ok) throw new Error(data.error || "Content unavailable");
      setPayload(data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Content unavailable");
    } finally {
      setLoading(false);
    }
  }, [missingSeo, page, query, status, type]);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setEditorOpen(true);
  }

  function openEdit(record: ContentRecord) {
    setEditing(record);
    setForm(contentToForm(record));
    setEditorOpen(true);
  }

  async function save() {
    setError("");
    const body = {
      ...form,
      tags: form.tags.split(",").map((entry) => entry.trim()).filter(Boolean),
      seoKeywords: form.seoKeywords.split(",").map((entry) => entry.trim()).filter(Boolean),
      estimatedMinutes: Number(form.estimatedMinutes) || 0,
    };
    const response = await fetch(editing ? `/api/support/content/${editing.id}` : "/api/support/content", {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      setError(data.error || "Save failed");
      return;
    }
    setNotice(editing ? "Content updated." : "Content created.");
    closeModal();
    await load();
  }

  function closeModal() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setEditorOpen(false);
  }

  async function runAction(record: ContentRecord, action: string) {
    setError("");
    const response = await fetch(`/api/support/content/${record.id}/${action}`, { method: "POST" });
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      setError(data.error || "Action failed");
      return;
    }
    setNotice(`Content ${action.replace("-", " ")} complete.`);
    await load();
  }

  return (
    <section className="flex flex-col gap-5">
      {error ? <Alert>{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap gap-3 border-b border-slate-200 bg-slate-50/70 p-4">
          <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} className="min-w-[220px] flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="Search content" />
          <select value={type} onChange={(event) => { setType(event.target.value); setPage(1); }} className="rounded-md border border-slate-300 px-3 py-2 text-sm">
            <option value="">All types</option>
            {PUBLIC_CONTENT_TYPES.map((entry) => <option key={entry} value={entry}>{entry.replace("_", " ")}</option>)}
          </select>
          <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} className="rounded-md border border-slate-300 px-3 py-2 text-sm">
            <option value="">All statuses</option>
            {PUBLIC_CONTENT_STATUSES.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <input type="checkbox" checked={missingSeo} onChange={(event) => { setMissingSeo(event.target.checked); setPage(1); }} />
            Missing SEO
          </label>
          <Button className="btn btn-primary" onClick={openCreate}>Create</Button>
          <Button className="btn btn-secondary" onClick={() => void load()}>Refresh</Button>
        </div>
        <div className="overflow-auto">
          <table className="w-full min-w-[1120px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Title</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Slug</th>
                <th className="px-3 py-2">SEO Health</th>
                <th className="px-3 py-2">Votes</th>
                <th className="px-3 py-2">Published</th>
                <th className="px-3 py-2">Updated</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(payload?.content ?? []).map((record) => (
                <tr key={record.id} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-2 font-semibold text-slate-900">{record.title}</td>
                  <td className="px-3 py-2">{record.type}</td>
                  <td className="px-3 py-2">{record.status}</td>
                  <td className="px-3 py-2">{record.slug}</td>
                  <td className="px-3 py-2">{seoLabel(record.seoIssues)}</td>
                  <td className="px-3 py-2">{record.voteCount}</td>
                  <td className="px-3 py-2">{formatDate(record.publishedAt)}</td>
                  <td className="px-3 py-2">{formatDate(record.updatedAt)}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      <Button className="btn btn-secondary" onClick={() => openEdit(record)}>Edit</Button>
                      {record.status === "published" ? <Link className="btn btn-secondary" href={record.canonicalPath}>Preview</Link> : null}
                      {record.status === "draft" ? <Button className="btn btn-secondary" onClick={() => void runAction(record, "submit-review")}>Review</Button> : null}
                      {record.status === "review" ? <Button className="btn btn-secondary" onClick={() => void runAction(record, "approve")}>Approve</Button> : null}
                      {record.status === "approved" ? <Button className="btn btn-primary" onClick={() => void runAction(record, "publish")}>Publish</Button> : null}
                      {record.status !== "archived" ? <Button className="btn btn-danger" onClick={() => void runAction(record, "archive")}>Archive</Button> : null}
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && (payload?.content ?? []).length === 0 ? (
                <tr><td colSpan={9} className="px-3 py-6 text-center text-slate-500">No content matches the current filters.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-slate-200 p-4 text-sm text-slate-600">
          <span>Page {payload?.pagination.page ?? 1} of {payload?.pagination.totalPages ?? 1} ({payload?.pagination.total ?? 0})</span>
          <div className="flex gap-2">
            <Button className="btn btn-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
            <Button className="btn btn-secondary" disabled={page >= (payload?.pagination.totalPages ?? 1)} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        </div>
      </div>
      <EditorModal open={editorOpen} form={form} setForm={setForm} editing={editing} onClose={closeModal} onSave={() => void save()} />
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="text-xs font-semibold uppercase text-slate-500">{label}</div><div className="mt-2 text-2xl font-bold text-slate-950">{value}</div></div>;
}

function SummaryCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><h3 className="mb-3 text-lg font-bold text-slate-950">{title}</h3>{children}</section>;
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-3 border-t border-slate-100 py-2 text-sm"><span className="text-slate-600">{label}</span><span className="font-semibold text-slate-900">{value}</span></div>;
}

function EditorModal({ open, form, setForm, editing, onClose, onSave }: { open: boolean; form: typeof EMPTY_FORM; setForm: (form: typeof EMPTY_FORM) => void; editing: ContentRecord | null; onClose: () => void; onSave: () => void }) {
  function update(key: keyof typeof EMPTY_FORM, value: string) {
    setForm({ ...form, [key]: value });
  }

  return (
    <ModalShell open={open} onRequestClose={onClose}>
      <div className="family-modal-card w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="modal-dialog-title-row family-modal-title-row mb-3">
          <h3 className="family-modal-title">{editing ? "Edit content" : "Create content"}</h3>
          <Button className="modal-close-button" aria-label="Close" onClick={onClose}>X</Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Type">
            <select
              value={form.type}
              disabled={Boolean(editing)}
              onChange={(event) => update("type", event.target.value)}
              className="h-10 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 disabled:bg-slate-50 disabled:text-slate-500">
              {EDITABLE_PUBLIC_CONTENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Input label="Locale" value={form.locale} onChange={(value) => update("locale", value)} />
          <Input label="Title" value={form.title} onChange={(value) => update("title", value)} />
          <Input label="Slug" value={form.slug} onChange={(value) => update("slug", value)} />
          <Input label="Short description" value={form.shortDescription} onChange={(value) => update("shortDescription", value)} />
          <Input label="Category" value={form.category} onChange={(value) => update("category", value)} />
          <Input label="Tags (comma-separated)" value={form.tags} onChange={(value) => update("tags", value)} />
          <Input label="Age range" value={form.ageRange} onChange={(value) => update("ageRange", value)} />
          <Input label="Difficulty" value={form.difficulty} onChange={(value) => update("difficulty", value)} />
          <Input label="Estimated minutes" value={form.estimatedMinutes} onChange={(value) => update("estimatedMinutes", value)} />
          <Input label="Image" value={form.image} onChange={(value) => update("image", value)} />
          <Input label="SEO title" value={form.seoTitle} onChange={(value) => update("seoTitle", value)} />
          <Input label="SEO description" value={form.seoDescription} onChange={(value) => update("seoDescription", value)} />
          <Input label="SEO keywords (comma-separated)" value={form.seoKeywords} onChange={(value) => update("seoKeywords", value)} />
          <Input label="Open Graph image" value={form.ogImage} onChange={(value) => update("ogImage", value)} />
          <p className="sm:col-span-2 text-sm text-slate-500 m-0">
            Preview path: /{form.type === "chore" ? "chores" : form.type === "reward" ? "rewards" : "resources"}/{form.slug || "slug"}
          </p>
          <Field label="Body" className="sm:col-span-2">
            <textarea
              value={form.body}
              onChange={(event) => update("body", event.target.value)}
              rows={8}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400"
            />
          </Field>
        </div>
        <div className="family-modal-actions mt-5">
          <Button className="btn btn-secondary" onClick={onClose}>Cancel</Button>
          <Button className="btn btn-primary" onClick={onSave}>Save</Button>
        </div>
      </div>
    </ModalShell>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`flex flex-col gap-1.5${className ? ` ${className}` : ""}`}>
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}

function Input({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <Field label={label}>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400"
      />
    </Field>
  );
}
