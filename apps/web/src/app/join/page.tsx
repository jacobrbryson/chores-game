import type { Metadata } from "next";
import { cookies } from "next/headers";
import { createTranslator, DEFAULT_LOCALE } from "@packages/locales";
import { Alert } from "@/components/alert";
import { JoinFamilyPanel } from "@/components/join-family-panel";
import { MarketingHomepage } from "@/components/marketing-homepage";
import { parseSessionToken } from "@/lib/auth/session";
import { buildJoinFamilyLabels } from "@/lib/family/join-labels";
import { normalizeFamilyInviteCode } from "@/lib/family/invite-code-format";

type JoinPageProps = {
  searchParams?: Promise<{ code?: string }>;
};

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Join your family",
  // An invite link is private to the person holding it.
  robots: { index: false, follow: false },
};

/**
 * Landing page for an invite link (`/join?code=…`). A signed-in visitor gets
 * the code prefilled and one tap to join; a signed-out visitor is asked to sign
 * in first, with the code preserved in the URL so it survives the round trip.
 */
export default async function JoinPage({ searchParams }: JoinPageProps) {
  const params = (await searchParams) ?? {};
  const code = normalizeFamilyInviteCode(params.code);
  const cookieStore = await cookies();
  const sessionUser = parseSessionToken(cookieStore.get("session_user")?.value);
  const t = createTranslator({ locale: sessionUser?.locale ?? DEFAULT_LOCALE });

  if (!sessionUser) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
    return (
      <main className="content-shell py-8">
        <div className="mx-auto mb-6 w-full max-w-md">
          <Alert tone="info">{t("joinFamily.description")}</Alert>
        </div>
        <MarketingHomepage
          googleClientId={
            process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID
          }
          gsiLoginUri={appUrl ? `${appUrl}/api/auth/google/gsi` : undefined}
          signInErrorMessage=""
          appleClientId={
            process.env.NEXT_PUBLIC_APPLE_SERVICES_ID ?? process.env.APPLE_SERVICES_ID
          }
          appleRedirectUri={appUrl ? `${appUrl}/` : undefined}
          appleLabel={t("auth.signInWithApple")}
          applePendingLabel={t("auth.signingInWithApple")}
          appleFailedMessage={t("auth.appleSignInFailed")}
        />
      </main>
    );
  }

  return (
    <main className="content-shell py-8">
      <JoinFamilyPanel labels={buildJoinFamilyLabels(t)} initialCode={code} />
    </main>
  );
}
