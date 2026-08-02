import type { Metadata } from "next";
import { DashboardHome } from "@/components/dashboard-home";
import { MarketingHomepage } from "@/components/marketing-homepage";
import { cookies } from "next/headers";
import { parseSessionToken } from "@/lib/auth/session";
import { DEFAULT_OG_IMAGE, SITE_URL } from "@/lib/seo";

type HomeProps = {
	searchParams?: Promise<{ error?: string }>;
};

const HOME_TITLE =
	"Family Chores | Organized chores, rewards, and live family visibility";
const HOME_DESCRIPTION =
	"Family Chores Game helps parents manage chores, rewards, managed child profiles, family awards, Google Tasks sync, and live household activity.";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
	title: { absolute: HOME_TITLE },
	description: HOME_DESCRIPTION,
	alternates: { canonical: "/" },
	openGraph: {
		type: "website",
		title: HOME_TITLE,
		description: HOME_DESCRIPTION,
		url: SITE_URL,
		images: [{ url: DEFAULT_OG_IMAGE, width: 1200, height: 630, alt: "Family Chores" }],
	},
	twitter: {
		card: "summary_large_image",
		title: HOME_TITLE,
		description: HOME_DESCRIPTION,
		images: [DEFAULT_OG_IMAGE],
	},
};

const homeStructuredData = {
	"@context": "https://schema.org",
	"@type": "WebApplication",
	name: "Family Chores",
	url: SITE_URL,
	applicationCategory: "LifestyleApplication",
	operatingSystem: "Web, iOS, Android",
	description: HOME_DESCRIPTION,
	offers: {
		"@type": "Offer",
		price: "0",
		priceCurrency: "USD",
	},
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
					<DashboardHome viewerKey={sessionUser.uid} />
				</main>
			) : (
				<>
					<script
						type="application/ld+json"
						dangerouslySetInnerHTML={{ __html: JSON.stringify(homeStructuredData) }}
					/>
					<MarketingHomepage
						googleClientId={googleClientId}
						gsiLoginUri={gsiLoginUri}
						signInErrorMessage={signInErrorMessage}
					/>
				</>
			)}
		</>
	);
}
