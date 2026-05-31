import Image from "next/image";
import { cookies } from "next/headers";
import { createTranslator } from "@packages/locales";
import { parseSessionToken } from "@/lib/auth/session";
import { getChangeLogEntries } from "@/lib/change-log";
import { DEFAULT_LOCALE } from "@/lib/locale";

function formatChangeLogDate(value: string, locale: string) {
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

function changeTypeKey(type: "Feature" | "Bug Fix") {
  return type === "Feature" ? "changeLog.types.feature" : "changeLog.types.bugFix";
}

export async function ChangeLogPage() {
  const cookieStore = await cookies();
  const sessionUser = parseSessionToken(cookieStore.get("session_user")?.value);
  const locale = sessionUser?.locale || DEFAULT_LOCALE;
  const t = createTranslator({ locale });
  const entries = getChangeLogEntries();

  return (
    <main className="panel family-page family-page-shell">
      <div className="page-header-row">
        <div className="page-header-inline">
          <h1>{t("changeLog.title")}</h1>
        </div>
      </div>
      <p className="small family-page-subhead">{t("changeLog.subtitle")}</p>

      {entries.length === 0 ? (
        <section className="family-page-card change-log-empty-card">
          <p className="small">{t("changeLog.empty")}</p>
        </section>
      ) : (
        <section className="change-log-list" aria-label={t("changeLog.title")}>
          {entries.map((entry) => {
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
        </section>
      )}
    </main>
  );
}
