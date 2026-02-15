import { cookies } from "next/headers";
import Image from "next/image";
import Script from "next/script";
import { parseSessionToken } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function Home() {
	const googleClientId =
		process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID;
	const cookieStore = await cookies();
	const sessionUser = parseSessionToken(
		cookieStore.get("session_user")?.value,
	);
	const profileInitial =
		sessionUser?.name?.trim().charAt(0).toUpperCase() ||
		sessionUser?.email?.trim().charAt(0).toUpperCase() ||
		"U";

	return (
		<div className="shell">
			{!sessionUser && googleClientId ? (
				<Script src="https://accounts.google.com/gsi/client" async defer />
			) : null}
			<div className="container">
				<nav className="top-nav panel">
					<p className="brand">Chore Quest</p>
					<div className="nav-links">
						{sessionUser ? (
							<details className="profile-menu">
								<summary>
									{sessionUser.picture ? (
										// eslint-disable-next-line @next/next/no-img-element
										<img
											className="profile-avatar"
											src={sessionUser.picture}
											alt={sessionUser.name || "User profile"}
											referrerPolicy="no-referrer"
										/>
									) : (
										<span className="profile-avatar profile-fallback">
											{profileInitial}
										</span>
									)}
								</summary>
								<div className="profile-dropdown">
									<p className="profile-name">
										{sessionUser.name || "Signed In"}
									</p>
									<p className="profile-email">{sessionUser.email}</p>
									<form action="/api/auth/logout" method="post">
										<button
											type="submit"
											className="btn btn-secondary profile-logout">
											Logout
										</button>
									</form>
								</div>
							</details>
						) : googleClientId ? (
							<>
								<div
									id="g_id_onload"
									data-client_id={googleClientId}
									data-context="signin"
									data-auto_prompt="false"
									data-ux_mode="redirect"
									data-login_uri="http://localhost:3000/api/auth/google/gsi"
									data-auto_select="false"
									data-itp_support="true"
									data-use_fedcm_for_prompt="false"
									data-use_fedcm_for_button="false"
								/>
								<div
									className="g_id_signin"
									data-type="standard"
									data-shape="rectangular"
									data-theme="outline"
									data-text="signin_with"
									data-size="large"
									data-logo_alignment="left"
								/>
							</>
						) : (
							<p className="small">Google sign-in is not configured.</p>
						)}
					</div>
				</nav>

				<main className="hero panel">
					<section className="hero-copy">
						<span className="badge">Family Chore Game</span>
						<h1>Turn daily chores into quests, coins, and cosmetics.</h1>
						<p>
							Parents assign and approve chores. Kids complete quests, earn
							coins on approval, and unlock avatar gear in the shop.
						</p>
					</section>

					<section id="how-it-works" className="card flow">
						<h2>How it works</h2>
						<p className="small how-subhead">
							Parent review drives progression. Coins are only awarded on
							approval.
						</p>
						<div className="how-layout">
							<ol className="how-steps">
								<li className="how-step">
									<span className="how-num">1</span>
									<p>
										<strong>Parent assigns chores</strong> with values and
										checklists.
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
										<strong>Parent approves or rejects</strong> with
										optional feedback.
									</p>
								</li>
								<li className="how-step">
									<span className="how-num">4</span>
									<p>
										<strong>Approved chores pay coins</strong> that can be
										spent in the shop.
									</p>
								</li>
							</ol>
							<div className="how-visual">
								<Image
									src="/loot2.png"
									alt="Kids in a chore quest scene"
									fill
									sizes="(max-width: 900px) 100vw, 320px"
									className="how-visual-image"
								/>
							</div>
						</div>
					</section>
				</main>
			</div>
		</div>
	);
}
