import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { ChangeLogTabs } from "@/components/change-log-tabs";
import { getChangeLogEntryGroup, getChangeLogEntryGroups, type ChangeLogEntryGroup, type ChangeLogEntryType } from "@/lib/change-log";

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

export function formatChangeLogGroupDate(group: ChangeLogEntryGroup, locale: string) {
  return formatChangeLogDate(group.date, locale);
}

function changeTypeKey(type: ChangeLogEntryType) {
  return type === "Feature" ? "changeLog.types.feature" : "changeLog.types.bugFix";
}

function NewIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="change-log-subject-icon change-log-subject-icon-new">
      <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z" />
    </svg>
  );
}

function BugIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="change-log-subject-icon change-log-subject-icon-bug">
      <path d="M8 2l1.5 1.5" /><path d="M14.5 3.5L16 2" />
      <path d="M9 7.5C9 6.1 10.1 5 11.5 5h1C13.9 5 15 6.1 15 7.5V12c0 1.4-1.1 2.5-2.5 2.5h-1C10.1 14.5 9 13.4 9 12V7.5z" />
      <path d="M9 9H5" /><path d="M19 9h-4" />
      <path d="M9 12H4" /><path d="M20 12h-5" />
      <path d="M9 14.5l-2 3" /><path d="M15 14.5l2 3" />
    </svg>
  );
}

function renderTypeList(
  title: string,
  type: "feature" | "bug-fix",
  chipClass: string,
  items: Array<{ id: string; subject: string; description: string }>,
  emptyLabel: string,
) {
  return (
    <section className="change-log-day-section">
      <span className={`change-log-badge ${chipClass}`}>{title}</span>
      {items.length === 0 ? (
        <p className="small">{emptyLabel}</p>
      ) : (
        <ul className="change-log-day-subject-list">
          {items.map((item) => (
            <li key={item.id} title={item.description}>
              {type === "feature" ? <NewIcon /> : <BugIcon />}
              {item.subject}
            </li>
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

function CalendarIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="change-log-date-icon"
    >
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

export function ChangeLogIndexContent({ locale, t }: { locale: string; t: Translate }) {
  const groups = getChangeLogEntryGroups();

  if (groups.length === 0) {
    return (
      <ChangeLogTabs
        recentContent={
        <section className="family-page-card change-log-empty-card">
          <p className="small">{t("changeLog.empty")}</p>
        </section>
        }
      />
    );
  }

  return (
    <ChangeLogTabs
      recentContent={
      <section className="change-log-day-list" aria-label={t("changeLog.title")}>
        {groups.map((group) => (
          <Link key={group.slug} href={`/change-log/${group.slug}`} className="family-page-card change-log-day-card">
            <div className="change-log-day-card-header">
              <time dateTime={group.date} className="change-log-date">
                <CalendarIcon />
                {formatChangeLogGroupDate(group, locale)}
              </time>
              <span className="change-log-day-card-arrow" aria-hidden="true">
                →
              </span>
            </div>
            {renderTypeList(
              t("changeLog.sections.features"),
              "feature",
              "change-log-badge-feature",
              group.features,
              t("changeLog.sections.emptyFeatures"),
            )}
            {renderTypeList(
              t("changeLog.sections.bugFixes"),
              "bug-fix",
              "change-log-badge-bug-fix",
              group.bugFixes,
              t("changeLog.sections.emptyBugFixes"),
            )}
          </Link>
        ))}
      </section>
      }
    />
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

  const formattedDate = formatChangeLogGroupDate(group, locale);

  return renderPageShell(
    formattedDate,
    t("changeLog.daySubtitle", { date: formattedDate }),
    <section className="change-log-list" aria-label={t("changeLog.title")}>
      {group.entries.map((entry) => {
        const badgeClass =
          entry.type === "Feature" ? "change-log-badge-feature" : "change-log-badge-bug-fix";

        if (entry.imageType === "hero") {
          return (
            <article key={entry.id} className="family-page-card change-log-card change-log-card-hero">
              <div className="change-log-hero-art">
                <Image
                  src={entry.image}
                  alt={t("changeLog.imageAlt", { subject: entry.subject })}
                  width={1280}
                  height={800}
                  className="change-log-hero-image"
                />
              </div>
              <div className="change-log-copy change-log-hero-copy">
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
        }

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
