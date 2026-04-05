import { FamilyCard } from "@/components/family-card";
import { MarketingHomepage } from "@/components/marketing-homepage";
import { cookies } from "next/headers";
import { parseSessionToken } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Family Chores | Organized chores, rewards, and live family visibility",
	description:
		"Family Chores Game helps parents assign and approve chores, motivate kids with rewards, connect Google Tasks, and keep household activity visible in realtime.",
};

export default async function Home() {
	const cookieStore = await cookies();
	const sessionUser = parseSessionToken(
		cookieStore.get("session_user")?.value,
	);
	const googleClientId =
		process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID;
	const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
	const gsiLoginUri = appUrl ? `${appUrl}/api/auth/google/gsi` : undefined;

	return (
		<>
			{sessionUser ? (
				<main className="dashboard panel">
					<FamilyCard />
				</main>
			) : (
				<MarketingHomepage
					googleClientId={googleClientId}
					gsiLoginUri={gsiLoginUri}
				/>
			)}
		</>
	);
}
