import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { parseSessionToken } from "@/lib/auth/session";
import { OnboardingWizard } from "@/components/onboarding-wizard";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Get Started | Family Chores",
};

export default async function OnboardingPage() {
  const cookieStore = await cookies();
  const sessionUser = parseSessionToken(cookieStore.get("session_user")?.value);

  if (!sessionUser) {
    redirect("/");
  }

  return (
    <main className="onboarding-page">
      <OnboardingWizard viewerName={sessionUser.name ?? ""} />
    </main>
  );
}
