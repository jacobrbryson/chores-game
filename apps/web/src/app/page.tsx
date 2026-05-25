import { FamilyCard } from "@/components/family-card";
import { MarketingHomepage } from "@/components/marketing-homepage";
import { cookies } from "next/headers";
import { parseSessionToken } from "@/lib/auth/session";

type HomeProps = {
	searchParams?: Promise<{ error?: string }>;
};

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Family Chores | Organized chores, rewards, and live family visibility",
	description:
		"Family Chores Game helps parents assign and approve chores, motivate kids with rewards, connect Google Tasks, and keep household activity visible in realtime.",
};

function getSignInErrorMessage(errorCode?: string) {
	switch (errorCode) {
		case "csrf_mismatch":
			return "Google sign-in could not finish because the browser did not preserve the sign-in check. On iPhone, try opening the site directly in Safari or Chrome and make sure cookies are allowed.";
		case "missing_credential":
			return "Google did not return the sign-in credential. Please try signing in again.";
		case "google_signin_failed":
			return "Google sign-in failed before the session could be created. Please try again, or open the site directly in Safari or Chrome if you are on iPhone.";
		default:
			return "";
	}
}

export default async function Home({ searchParams }: HomeProps) {
	const params = (await searchParams) ?? {};
	const cookieStore = await cookies();
	const sessionUser = parseSessionToken(
		cookieStore.get("session_user")?.value,
	);
	const signInErrorMessage = getSignInErrorMessage(params.error?.trim());
	const googleClientId =
		process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID;
	const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
	const gsiLoginUri = appUrl ? `${appUrl}/api/auth/google/gsi` : undefined;

	return (
		<>
			{sessionUser ? (
				<main className="dashboard">
					<FamilyCard />
				</main>
			) : (
				<MarketingHomepage
					googleClientId={googleClientId}
					gsiLoginUri={gsiLoginUri}
					signInErrorMessage={signInErrorMessage}
				/>
			)}
		</>
	);
}
