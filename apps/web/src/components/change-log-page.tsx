import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { getChangeLogEntryGroup, getChangeLogEntryGroups, type ChangeLogEntryType } from "@/lib/change-log";

type Translate = (key: string, params?: Record<string, string | number>) => string;

export function formatChangeLogDate(value: string, locale: string) {
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed)) {
    return value;
  }

  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(parsed));
}

function changeTypeKey(type: ChangeLogEntryType) {
  return type === "Feature" ? "changeLog.types.feature" : "changeLog.types.bugFix";
}

function renderTypeList(
  title: string,
  items: Array<{ id: string; subject: string }>,
  emptyLabel: string,
) {
  return (
    <section className="change-log-day-section">
      <h2>{title}</h2>
      {items.length === 0 ? (
        <p className="small">{emptyLabel}</p>
      ) : (
        <ul className="change-log-day-subject-list">
          {items.map((item) => (
            <li key={item.id}>{item.subject}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function renderPageShell(title: string, subtitle: string, content: ReactNode) {
  return (
    <main className="panel family-page family-page-shell">
      <div className="page-header-row">
        <div className="page-header-inline">
          <h1>{title}</h1>
        </div>
      </div>
      <p className="small family-page-subhead">{subtitle}</p>
      {content}
    </main>
  );
}

export function ChangeLogIndexContent({ locale, t }: { locale: string; t: Translate }) {
  const groups = getChangeLogEntryGroups();

  if (groups.length === 0) {
    return renderPageShell(
      t("changeLog.title"),
      t("changeLog.subtitle"),
      <section className="family-page-card change-log-empty-card">
        <p className="small">{t("changeLog.empty")}</p>
      </section>,
    );
  }

  return renderPageShell(
    t("changeLog.title"),
    t("changeLog.subtitle"),
    <section className="change-log-day-list" aria-label={t("changeLog.title")}>
      {groups.map((group) => (
        <Link key={group.date} href={`/change-log/${group.date}`} className="family-page-card change-log-day-card">
          <div className="change-log-day-card-header">
            <time dateTime={group.date} className="change-log-date">
              {formatChangeLogDate(group.date, locale)}
            </time>
            <span className="change-log-day-card-arrow" aria-hidden="true">
              →
            </span>
          </div>
          {renderTypeList(
            t("changeLog.sections.features"),
            group.features,
            t("changeLog.sections.emptyFeatures"),
          )}
          {renderTypeList(
            t("changeLog.sections.bugFixes"),
            group.bugFixes,
            t("changeLog.sections.emptyBugFixes"),
          )}
        </Link>
      ))}
    </section>,
  );
}

export function ChangeLogDateContent({
  date,
  locale,
  t,
}: {
  date: string;
  locale: string;
  t: Translate;
}) {
  const group = getChangeLogEntryGroup(date);

  if (!group) {
    return renderPageShell(
      t("changeLog.title"),
      t("changeLog.daySubtitleMissing", { date }),
      <section className="family-page-card change-log-empty-card">
        <p className="small">{t("changeLog.empty")}</p>
      </section>,
    );
  }

  return renderPageShell(
    formatChangeLogDate(group.date, locale),
    t("changeLog.daySubtitle", { date: formatChangeLogDate(group.date, locale) }),
    <section className="change-log-list" aria-label={t("changeLog.title")}>
      {group.entries.map((entry) => {
        const badgeClass =
          entry.type === "Feature" ? "change-log-badge-feature" : "change-log-badge-bug-fix";

        return (
          <article key={entry.id} className="family-page-card change-log-card">
            <div className="change-log-art">
              <Image
                src={entry.image}
                alt={t("changeLog.imageAlt", { subject: entry.subject })}
                width={64}
                height={64}
                className="change-log-art-image"
              />
            </div>
            <div className="change-log-copy">
              <div className="change-log-meta">
                <time dateTime={entry.date} className="change-log-date">
                  {formatChangeLogDate(entry.date, locale)}
                </time>
                <span className={`change-log-badge ${badgeClass}`}>
                  {t(changeTypeKey(entry.type))}
                </span>
              </div>
              <h2>{entry.subject}</h2>
              <p className="change-log-description">{entry.description}</p>
            </div>
          </article>
        );
      })}
    </section>,
  );
}
