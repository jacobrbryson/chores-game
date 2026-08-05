import { randomUUID } from "node:crypto";
import { getCanonicalAppOrigin } from "@/lib/app-origin";
import { isFamilyFriendInviteEmailEnabled } from "@/lib/email/preferences";
import { getEmailProvider, getEmailReplyToAddresses } from "@/lib/email/provider";
import { adminCreateOrReplaceDocument } from "@/lib/firestore/admin";
import { stringArrayField, stringField, timestampField } from "@/lib/firestore/rest";

type FriendInviteNotificationInput = {
  inviteId: string;
  token: string;
  fromFamilyName: string;
  fromAdminName: string;
  toEmail: string;
  toFamilyId?: string;
  targetAdminUid?: string;
  locale?: string;
};

const COPY = {
  "en-US": {
    wants: (family: string) => `${family} wants to be Family Friends`,
    invited: (name: string) => `${name} invited your families to share positive activity.`,
    subject: (family: string) => `${family} invited you to be Family Friends`,
    heading: "Let’s celebrate together",
    intro: (name: string, family: string) => `${name} invited your family to become Family Friends with ${family}.`,
    body: "Family Friends can see one another’s positive chore wins and milestones. Parents can also discover and copy Family Awards.",
    confirm: "Confirm Family Friends",
    note: "Only a parent/admin can confirm. If you do not have a Family Chores family yet, sign in and create one first.",
    acceptedTitle: (family: string) => `You are now Family Friends with ${family}`,
    acceptedMessage: "Positive family wins will now appear in your shared feed.",
    removedTitle: (family: string) => `${family} ended the Family Friends connection`,
    removedMessage: "Your families’ activity feeds are no longer shared.",
  },
  "fr-FR": {
    wants: (family: string) => `${family} souhaite devenir une famille amie`,
    invited: (name: string) => `${name} a invité vos familles à partager leurs réussites.`,
    subject: (family: string) => `${family} vous invite à devenir une famille amie`,
    heading: "Célébrons ensemble",
    intro: (name: string, family: string) => `${name} invite votre famille à devenir amie avec ${family}.`,
    body: "Les familles amies voient leurs réussites positives et leurs étapes importantes. Les parents peuvent aussi découvrir et copier des récompenses familiales.",
    confirm: "Confirmer la famille amie",
    note: "Seul un parent ou administrateur peut confirmer. Si vous n’avez pas encore de famille Family Chores, connectez-vous et créez-en une.",
    acceptedTitle: (family: string) => `Vous êtes maintenant amis avec ${family}`,
    acceptedMessage: "Les réussites positives apparaîtront maintenant dans votre fil partagé.",
    removedTitle: (family: string) => `${family} a mis fin à la connexion entre familles amies`,
    removedMessage: "Les fils d’activité de vos familles ne sont plus partagés.",
  },
  "es-US": {
    wants: (family: string) => `${family} quiere ser una familia amiga`,
    invited: (name: string) => `${name} invitó a sus familias a compartir logros positivos.`,
    subject: (family: string) => `${family} te invitó a ser una familia amiga`,
    heading: "Celebremos juntos",
    intro: (name: string, family: string) => `${name} invitó a tu familia a conectarse con ${family}.`,
    body: "Las familias amigas pueden ver los logros positivos y momentos importantes de los demás. Los padres también pueden descubrir y copiar premios familiares.",
    confirm: "Confirmar Familias amigas",
    note: "Solo un padre o administrador puede confirmar. Si aún no tienes una familia en Family Chores, inicia sesión y crea una primero.",
    acceptedTitle: (family: string) => `Ahora son familias amigas de ${family}`,
    acceptedMessage: "Los logros positivos de ambas familias aparecerán en el feed compartido.",
    removedTitle: (family: string) => `${family} finalizó la conexión de Familias amigas`,
    removedMessage: "Los feeds de actividad de sus familias ya no se comparten.",
  },
} as const;

function copyFor(locale: string | undefined) {
  return COPY[locale === "fr-FR" || locale === "es-US" ? locale : "en-US"];
}

export function familyFriendStatusCopy(
  locale: string | undefined,
  kind: "accepted" | "removed",
  otherFamilyName: string,
) {
  const copy = copyFor(locale);
  return kind === "accepted"
    ? { title: copy.acceptedTitle(otherFamilyName), message: copy.acceptedMessage }
    : { title: copy.removedTitle(otherFamilyName), message: copy.removedMessage };
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
}

async function writeInviteNotification(input: FriendInviteNotificationInput) {
  if (!input.toFamilyId) return;
  const now = new Date().toISOString();
  const copy = copyFor(input.locale);
  await adminCreateOrReplaceDocument(`families/${input.toFamilyId}/notifications/${randomUUID()}`, {
    familyId: stringField(input.toFamilyId),
    kind: stringField("family_friend_request"),
    actorUid: stringField(""),
    actorEmail: stringField(""),
    actorName: stringField(input.fromAdminName),
    title: stringField(copy.wants(input.fromFamilyName)),
    message: stringField(copy.invited(input.fromAdminName)),
    relatedIds: stringArrayField([input.targetAdminUid || "", input.toEmail].filter(Boolean)),
    inviteId: stringField(input.inviteId),
    createdAt: timestampField(now),
  });
}

async function sendInviteEmail(input: FriendInviteNotificationInput) {
  // Recipients who turned Family Friend Invites off in Profile → Notifications →
  // Email still get the in-app notification and can approve or decline there.
  if (input.targetAdminUid && !(await isFamilyFriendInviteEmailEnabled(input.targetAdminUid))) {
    return "skipped" as const;
  }
  const origin = getCanonicalAppOrigin();
  const copy = copyFor(input.locale);
  const confirmUrl = `${origin}/api/family-friends/invitations/email-confirm?invite=${encodeURIComponent(input.inviteId)}&token=${encodeURIComponent(input.token)}`;
  const subject = copy.subject(input.fromFamilyName);
  const text = `${copy.intro(input.fromAdminName, input.fromFamilyName)}\n\n${copy.confirm}: ${confirmUrl}\n\n${copy.body}\n\n${copy.note}`;
  const html = `<!doctype html><html lang="${escapeHtml(input.locale || "en-US")}"><body style="margin:0;background:#f8fafc;font-family:Arial,sans-serif;color:#0f172a"><div style="max-width:620px;margin:0 auto;padding:24px"><div style="background:#fff;border:1px solid #e2e8f0;border-radius:20px;overflow:hidden"><div style="padding:28px;background:linear-gradient(135deg,#0f766e,#2563eb);color:#fff"><div style="font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase">Family Chores</div><h1 style="margin:10px 0 8px;font-size:28px">${escapeHtml(copy.heading)}</h1><p style="margin:0;line-height:1.6">${escapeHtml(copy.intro(input.fromAdminName, input.fromFamilyName))}</p></div><div style="padding:24px"><p style="line-height:1.7">${escapeHtml(copy.body)}</p><a href="${escapeHtml(confirmUrl)}" style="display:inline-block;margin-top:8px;background:#0f172a;color:#fff;text-decoration:none;padding:13px 20px;border-radius:999px;font-weight:700">${escapeHtml(copy.confirm)}</a><p style="margin-top:20px;color:#64748b;font-size:13px;line-height:1.6">${escapeHtml(copy.note)}</p></div></div></div></body></html>`;
  await getEmailProvider().send({
    to: [input.toEmail],
    subject,
    text,
    html,
    replyTo: getEmailReplyToAddresses().length ? getEmailReplyToAddresses() : undefined,
  });
  return "sent" as const;
}

export async function notifyFamilyFriendInvite(input: FriendInviteNotificationInput) {
  const [inAppResult, emailResult] = await Promise.allSettled([
    writeInviteNotification(input),
    sendInviteEmail(input),
  ]);
  for (const result of [inAppResult, emailResult]) {
    if (result.status === "rejected") {
      console.warn("[FAMILY_FRIEND_INVITE_NOTIFY_SKIPPED]", result.reason instanceof Error ? result.reason.message.slice(0, 180) : "unknown");
    }
  }
  // `emailOptedOut` keeps a deliberate opt-out from being reported to the
  // inviter as a delivery failure.
  const emailOptedOut = emailResult.status === "fulfilled" && emailResult.value === "skipped";
  return {
    inApp: inAppResult.status === "fulfilled",
    email: emailResult.status === "fulfilled" && !emailOptedOut,
    emailOptedOut,
  };
}
