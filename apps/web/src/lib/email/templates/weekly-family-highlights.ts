import {
  createTranslator,
  type AppLocale,
} from "@packages/locales";
import { resolveInitial } from "@/lib/avatar/resolve";
import { DEFAULT_MEMBER_PRIMARY_COLOR } from "@/lib/theme/member-primary-color";
import { FEED_FALLBACK_EMOJI } from "@/lib/feed/feed-events";

type WeeklyHighlightItem = {
  title: string;
  message: string;
  createdAt: string;
  icon?: string;
};

type WeeklyMetricLine = {
  labelKey: string;
  value: number;
  emoji: string;
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
  mostActiveHelperAvatarUrl?: string;
  mostActiveHelperAvatarColor?: string;
  recentHighlights: WeeklyHighlightItem[];
  proTip: string;
  // Athena Learning Companion link callout. When `athenaLinkUrl` is set, the
  // email features a promo block inviting the parent to link their account.
  athenaLinkUrl?: string;
  // Absolute URL to the hosted Athena glyph PNG. Falls back to an inline SVG
  // (which Gmail/Outlook strip) when omitted.
  athenaIconUrl?: string;
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// Reproduce the in-app avatar's `color-mix(in srgb, <primary> 72%, white)` tint,
// since email clients don't support color-mix or CSS variables. `primaryWeight` is
// the primary's share (0–1); the remainder is mixed with white.
function mixHexWithWhite(hex: string, primaryWeight: number) {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) {
    return hex;
  }
  const int = Number.parseInt(match[1], 16);
  const channels = [(int >> 16) & 0xff, (int >> 8) & 0xff, int & 0xff];
  const toHex = (channel: number) =>
    Math.round(channel * primaryWeight + 255 * (1 - primaryWeight))
      .toString(16)
      .padStart(2, "0");
  return `#${channels.map(toHex).join("")}`;
}

function renderMetricRow(emoji: string, label: string, value: number) {
  return `<tr><td style="padding:8px 0;color:#334155;"><span style="display:inline-block;width:22px;text-align:center;">${escapeHtml(emoji)}</span>&nbsp;${escapeHtml(label)}</td><td style="padding:8px 0;color:#0f172a;font-weight:700;text-align:right;">${value}</td></tr>`;
}

function buildMetrics(props: WeeklyFamilyHighlightsTemplateProps): WeeklyMetricLine[] {
  return [
    { labelKey: "newsletter.weekly.metrics.choresCompleted", value: props.choresCompleted, emoji: "🧹" },
    { labelKey: "newsletter.weekly.metrics.coinsEarned", value: props.coinsEarned, emoji: "🪙" },
    { labelKey: "newsletter.weekly.metrics.rewardsRedeemed", value: props.rewardsRedeemed, emoji: "🎁" },
    { labelKey: "newsletter.weekly.metrics.familyAwardsClaimed", value: props.familyAwardsClaimed, emoji: "🏆" },
    { labelKey: "newsletter.weekly.metrics.questsCompleted", value: props.questsCompleted, emoji: "🗺️" },
    { labelKey: "newsletter.weekly.metrics.achievementsUnlocked", value: props.achievementsUnlocked, emoji: "🏅" },
    { labelKey: "newsletter.weekly.metrics.pendingApprovals", value: props.pendingApprovals, emoji: "⏳" },
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
    .map((item) => {
      const icon = item.icon?.trim() || FEED_FALLBACK_EMOJI;
      return `<tr><td style="padding:0 10px 12px 0;vertical-align:top;font-size:18px;line-height:1.3;">${escapeHtml(icon)}</td><td style="padding:0 0 12px;vertical-align:top;"><strong>${escapeHtml(item.title)}</strong><br /><span style="color:#475569;">${escapeHtml(item.message)}</span></td></tr>`;
    })
    .join("");
  const helperLine = props.mostActiveHelperName
    ? t("newsletter.weekly.mostActiveHelperValue", {
        name: props.mostActiveHelperName,
        count: props.mostActiveHelperCount,
      })
    : t("newsletter.weekly.noMostActiveHelper");
  const helperAvatarUrl = props.mostActiveHelperAvatarUrl?.trim() ?? "";
  const helperInitial = resolveInitial(props.mostActiveHelperName);
  // Mirror <Avatar />: 2px solid primary ring, a lightened-primary fill behind the
  // initial (white text), matching the member's selected dashboard color.
  const avatarPrimary = props.mostActiveHelperAvatarColor?.trim() || DEFAULT_MEMBER_PRIMARY_COLOR;
  const avatarSecondary = mixHexWithWhite(avatarPrimary, 0.72);
  const helperAvatar = props.mostActiveHelperName
    ? helperAvatarUrl
      ? `<img src="${escapeHtml(helperAvatarUrl)}" width="40" height="40" alt="${escapeHtml(props.mostActiveHelperName)}" style="display:block;width:40px;height:40px;border-radius:999px;border:2px solid ${escapeHtml(avatarPrimary)};background:${escapeHtml(avatarSecondary)};object-fit:cover;" />`
      : `<span style="display:inline-block;width:40px;height:40px;border-radius:999px;border:2px solid ${escapeHtml(avatarPrimary)};background:${escapeHtml(avatarSecondary)};color:#ffffff;font-size:18px;font-weight:700;line-height:40px;text-align:center;">${escapeHtml(helperInitial)}</span>`
    : "";

  const showAthenaCallout = Boolean(props.athenaLinkUrl);
  const athenaBenefits = [
    t("newsletter.weekly.athena.benefits.suggestions"),
    t("newsletter.weekly.athena.benefits.coins"),
    t("newsletter.weekly.athena.benefits.nextChore"),
  ];
  const athenaBenefitRows = athenaBenefits
    .map(
      (benefit) =>
        `<tr><td style="padding:3px 8px 3px 0;vertical-align:top;font-size:15px;line-height:1.4;">✨</td><td style="padding:3px 0;vertical-align:top;font-size:14px;line-height:1.5;color:#ffffff;">${escapeHtml(benefit)}</td></tr>`,
    )
    .join("");
  // Same sparkle/sun glyph used in-app for Athena (see <AthenaGlyph /> and
  // <AthenaAvatar />). Prefer the hosted PNG (renders everywhere); fall back to
  // inline SVG (which Gmail/Outlook strip) when no icon URL is provided.
  const athenaGlyph = props.athenaIconUrl
    ? `<img src="${escapeHtml(props.athenaIconUrl)}" width="40" height="40" alt="" style="display:block;width:40px;height:40px;margin:0 auto;" />`
    : `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;margin:0 auto;"><path d="M12 3v2" /><path d="M12 19v2" /><path d="M5 12H3" /><path d="M21 12h-2" /><circle cx="12" cy="12" r="4" /><path d="m6.3 6.3 1.4 1.4" /><path d="m16.3 16.3 1.4 1.4" /></svg>`;
  const athenaIconBadge = `<table role="presentation" cellpadding="0" cellspacing="0" style="width:64px;height:64px;border-radius:16px;background:rgba(255,255,255,0.18);"><tr><td align="center" valign="middle" style="text-align:center;vertical-align:middle;">${athenaGlyph}</td></tr></table>`;
  const athenaCalloutHtml = showAthenaCallout
    ? `<div style="margin-top:22px;padding:20px;border-radius:16px;background:linear-gradient(135deg,#7c3aed,#c026d3);color:#ffffff;">
            <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr>
              <td style="padding-right:12px;vertical-align:middle;">${athenaIconBadge}</td>
              <td style="vertical-align:middle;">
                <div style="font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#ffffff;opacity:0.85;">${escapeHtml(t("newsletter.weekly.athena.eyebrow"))}</div>
                <h2 style="margin:4px 0 0;font-size:18px;color:#ffffff;">${escapeHtml(t("newsletter.weekly.athena.title"))}</h2>
              </td>
            </tr></table>
            <p style="margin:12px 0 12px;font-size:14px;line-height:1.6;color:#ffffff;opacity:0.95;">${escapeHtml(t("newsletter.weekly.athena.intro"))}</p>
            <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${athenaBenefitRows}</table>
            <a href="${escapeHtml(props.athenaLinkUrl ?? "")}" style="display:inline-block;margin-top:16px;background:#ffffff;color:#6d28d9;text-decoration:none;padding:11px 18px;border-radius:999px;font-weight:700;">${escapeHtml(t("newsletter.weekly.athena.cta"))}</a>
          </div>`
    : "";

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
            ${metrics.map((metric) => renderMetricRow(metric.emoji, t(metric.labelKey), metric.value)).join("")}
          </table>
          <div style="margin-top:22px;padding:16px;border-radius:16px;background:#f8fafc;border:1px solid #e2e8f0;">
            <div style="font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#475569;">${escapeHtml(t("newsletter.weekly.mostActiveHelper"))}</div>
            <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:8px;border-collapse:collapse;"><tr>
              ${helperAvatar ? `<td style="padding-right:12px;vertical-align:middle;">${helperAvatar}</td>` : ""}
              <td style="vertical-align:middle;font-size:18px;font-weight:700;color:#0f172a;">${escapeHtml(helperLine)}</td>
            </tr></table>
          </div>
          <div style="margin-top:22px;">
            <h2 style="margin:0 0 10px;font-size:18px;">${escapeHtml(t("newsletter.weekly.recentHighlights"))}</h2>
            ${recentHighlights ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">${recentHighlights}</table>` : `<p style="margin:0;color:#475569;">${escapeHtml(t("newsletter.weekly.noRecentHighlights"))}</p>`}
          </div>
          ${athenaCalloutHtml}
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
    ...metrics.map((metric) => `${metric.emoji} ${t(metric.labelKey)}: ${metric.value}`),
    "",
    `${t("newsletter.weekly.mostActiveHelper")}: ${helperLine}`,
    "",
    `${t("newsletter.weekly.proTip")}: ${props.proTip}`,
    "",
    t("newsletter.weekly.recentHighlights"),
    ...(props.recentHighlights.length > 0
      ? props.recentHighlights.map((item) => `${item.icon?.trim() || FEED_FALLBACK_EMOJI} ${item.title}: ${item.message}`)
      : [t("newsletter.weekly.noRecentHighlights")]),
    ...(showAthenaCallout
      ? [
          "",
          t("newsletter.weekly.athena.eyebrow"),
          t("newsletter.weekly.athena.title"),
          t("newsletter.weekly.athena.intro"),
          ...athenaBenefits.map((benefit) => `- ${benefit}`),
          `${t("newsletter.weekly.athena.cta")}: ${props.athenaLinkUrl ?? ""}`,
        ]
      : []),
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
