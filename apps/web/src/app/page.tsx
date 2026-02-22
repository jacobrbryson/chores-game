import { FamilyCard } from "@/components/family-card";
import { cookies } from "next/headers";
import { parseSessionToken } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function Home() {
	const cookieStore = await cookies();
	const sessionUser = parseSessionToken(
		cookieStore.get("session_user")?.value,
	);

	return (
		<>
			{sessionUser ? (
				<main className="dashboard panel">
					<FamilyCard />
				</main>
			) : (
				<main className="hero panel">
					<section className="hero-copy">
						<span className="badge">Family Chore Game</span>
						<h1>Turn daily chores into quests, coins, and cosmetics.</h1>
						<p>
							Parents assign and approve chores. Kids complete quests, earn coins on
							approval, and unlock avatar gear in the shop.
						</p>
					</section>

					<section id="how-it-works" className="card flow">
						<h2>How it works</h2>
						<p className="small how-subhead">
							Parent review drives progression. Coins are only awarded on approval.
						</p>
						<div className="how-layout">
							<ol className="how-steps">
								<li className="how-step">
									<span className="how-num">1</span>
									<p>
										<strong>Parent assigns chores</strong> with values and checklists.
									</p>
								</li>
								<li className="how-step">
									<span className="how-num">2</span>
									<p>
										<strong>Kid submits completion</strong> for review.
									</p>
								</li>
								<li className="how-step">
									<span className="how-num">3</span>
									<p>
										<strong>Parent approves or rejects</strong> with optional feedback.
									</p>
								</li>
								<li className="how-step">
									<span className="how-num">4</span>
									<p>
										<strong>Approved chores pay coins</strong> that can be spent in the
										shop.
									</p>
								</li>
							</ol>
						</div>
					</section>
				</main>
			)}
		</>
	);
}
