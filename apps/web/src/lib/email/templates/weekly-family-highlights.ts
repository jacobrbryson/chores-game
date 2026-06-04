import {
  createTranslator,
  type AppLocale,
} from "@packages/locales";

type WeeklyHighlightItem = {
  title: string;
  message: string;
  createdAt: string;
};

type WeeklyMetricLine = {
  labelKey: string;
  value: number;
};

export type WeeklyFamilyHighlightsTemplateProps = {
  appName: string;
  senderIdentity: string;
  familyName: string;
  weekStartLabel: string;
  weekEndLabel: string;
  dashboardUrl: string;
  managePreferencesUrl: string;
  choresCompleted: number;
  coinsEarned: number;
  rewardsRedeemed: number;
  familyAwardsClaimed: number;
  questsCompleted: number;
  achievementsUnlocked: number;
  pendingApprovals: number;
  mostActiveHelperName: string;
  mostActiveHelperCount: number;
  recentHighlights: WeeklyHighlightItem[];
  proTip: string;
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderMetricRow(label: string, value: number) {
  return `<tr><td style="padding:8px 0;color:#334155;">${escapeHtml(label)}</td><td style="padding:8px 0;color:#0f172a;font-weight:700;text-align:right;">${value}</td></tr>`;
}

function buildMetrics(props: WeeklyFamilyHighlightsTemplateProps): WeeklyMetricLine[] {
  return [
    { labelKey: "newsletter.weekly.metrics.choresCompleted", value: props.choresCompleted },
    { labelKey: "newsletter.weekly.metrics.coinsEarned", value: props.coinsEarned },
    { labelKey: "newsletter.weekly.metrics.rewardsRedeemed", value: props.rewardsRedeemed },
    { labelKey: "newsletter.weekly.metrics.familyAwardsClaimed", value: props.familyAwardsClaimed },
    { labelKey: "newsletter.weekly.metrics.questsCompleted", value: props.questsCompleted },
    { labelKey: "newsletter.weekly.metrics.achievementsUnlocked", value: props.achievementsUnlocked },
    { labelKey: "newsletter.weekly.metrics.pendingApprovals", value: props.pendingApprovals },
  ];
}

export function renderWeeklyFamilyHighlightsTemplate(input: {
  locale: AppLocale;
  familyLocale?: AppLocale | null;
  props: WeeklyFamilyHighlightsTemplateProps;
}) {
  const { props } = input;
  const t = createTranslator({
    locale: input.locale,
    familyLocale: input.familyLocale,
  });

  const dateRange = `${props.weekStartLabel} - ${props.weekEndLabel}`;
  const subject = t("newsletter.weekly.subject", {
    startDate: props.weekStartLabel,
    endDate: props.weekEndLabel,
  });
  const greeting = t("newsletter.weekly.greeting", {
    familyName: props.familyName || t("newsletter.weekly.familyFallbackName"),
  });
  const intro = t("newsletter.weekly.intro", { dateRange });
  const metrics = buildMetrics(props);
  const recentHighlights = props.recentHighlights
    .map((item) => `<li style="margin-bottom:10px;"><strong>${escapeHtml(item.title)}</strong><br /><span style="color:#475569;">${escapeHtml(item.message)}</span></li>`)
    .join("");
  const helperLine = props.mostActiveHelperName
    ? t("newsletter.weekly.mostActiveHelperValue", {
        name: props.mostActiveHelperName,
        count: props.mostActiveHelperCount,
      })
    : t("newsletter.weekly.noMostActiveHelper");

  const html = `<!doctype html>
<html lang="${escapeHtml(input.locale)}">
  <body style="margin:0;background:#f8fafc;font-family:Arial,sans-serif;color:#0f172a;">
    <div style="max-width:640px;margin:0 auto;padding:24px;">
      <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:20px;overflow:hidden;">
        <div style="background:linear-gradient(135deg,#0f766e,#1d4ed8);padding:28px 24px;color:#ffffff;">
          <div style="font-size:12px;letter-spacing:0.12em;text-transform:uppercase;opacity:0.88;">${escapeHtml(props.appName)}</div>
          <h1 style="margin:10px 0 8px;font-size:28px;line-height:1.2;">${escapeHtml(t("newsletter.weekly.title"))}</h1>
          <p style="margin:0;font-size:16px;line-height:1.5;">${escapeHtml(greeting)}</p>
        </div>
        <div style="padding:24px;">
          <p style="margin-top:0;font-size:15px;line-height:1.6;">${escapeHtml(intro)}</p>
          <table style="width:100%;border-collapse:collapse;margin:18px 0 10px;">
            ${metrics.map((metric) => renderMetricRow(t(metric.labelKey), metric.value)).join("")}
          </table>
          <div style="margin-top:22px;padding:16px;border-radius:16px;background:#f8fafc;border:1px solid #e2e8f0;">
            <div style="font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#475569;">${escapeHtml(t("newsletter.weekly.mostActiveHelper"))}</div>
            <div style="margin-top:6px;font-size:18px;font-weight:700;color:#0f172a;">${escapeHtml(helperLine)}</div>
          </div>
          <div style="margin-top:22px;">
            <h2 style="margin:0 0 10px;font-size:18px;">${escapeHtml(t("newsletter.weekly.recentHighlights"))}</h2>
            ${recentHighlights ? `<ul style="padding-left:20px;margin:0;">${recentHighlights}</ul>` : `<p style="margin:0;color:#475569;">${escapeHtml(t("newsletter.weekly.noRecentHighlights"))}</p>`}
          </div>
          <div style="margin-top:22px;padding:16px;border-radius:16px;background:#fff7ed;border:1px solid #fed7aa;">
            <div style="font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#9a3412;">${escapeHtml(t("newsletter.weekly.proTip"))}</div>
            <p style="margin:8px 0 0;line-height:1.6;color:#7c2d12;">${escapeHtml(props.proTip)}</p>
          </div>
          <div style="margin-top:24px;">
            <a href="${escapeHtml(props.dashboardUrl)}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:999px;font-weight:700;">${escapeHtml(t("newsletter.weekly.openDashboard"))}</a>
          </div>
        </div>
        <div style="padding:18px 24px;border-top:1px solid #e2e8f0;background:#f8fafc;color:#475569;font-size:13px;line-height:1.6;">
          <div><a href="${escapeHtml(props.managePreferencesUrl)}" style="color:#1d4ed8;">${escapeHtml(t("newsletter.weekly.managePreferences"))}</a></div>
          <div>${escapeHtml(props.appName)} · ${escapeHtml(props.senderIdentity)}</div>
        </div>
      </div>
    </div>
  </body>
</html>`;

  const text = [
    props.appName,
    "",
    t("newsletter.weekly.title"),
    greeting,
    intro,
    "",
    ...metrics.map((metric) => `${t(metric.labelKey)}: ${metric.value}`),
    "",
    `${t("newsletter.weekly.mostActiveHelper")}: ${helperLine}`,
    `${t("newsletter.weekly.proTip")}: ${props.proTip}`,
    "",
    t("newsletter.weekly.recentHighlights"),
    ...(props.recentHighlights.length > 0
      ? props.recentHighlights.map((item) => `- ${item.title}: ${item.message}`)
      : [t("newsletter.weekly.noRecentHighlights")]),
    "",
    `${t("newsletter.weekly.openDashboard")}: ${props.dashboardUrl}`,
    `${t("newsletter.weekly.managePreferences")}: ${props.managePreferencesUrl}`,
    `${props.appName} · ${props.senderIdentity}`,
  ].join("\n");

  return {
    subject,
    html,
    text,
  };
}
