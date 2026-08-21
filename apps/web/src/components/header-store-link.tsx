"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CoinIcon } from "@/components/coin-icon";
import { DiscoveryBadge } from "@/components/discovery-badge";
import { getSectionCount, useDiscoverySummary } from "@/lib/hooks/use-discovery";
import { dedupedFetch } from "@/lib/api/deduped-fetch";

type HeaderStoreLinkProps = {
	visible: boolean;
};

function formatCompactBalance(value: number) {
	if (value < 1000) {
		return `${value}`;
	}
	if (value < 1_000_000) {
		return `${(value / 1000).toFixed(1)}k`;
	}
	if (value < 1_000_000_000) {
		return `${(value / 1_000_000).toFixed(1)}m`;
	}
	return `${(value / 1_000_000_000).toFixed(1)}b`;
}

export function HeaderStoreLink({ visible }: HeaderStoreLinkProps) {
	const [balance, setBalance] = useState(0);
	// Store discovery badge: total unseen visible store items across categories.
	const { summary } = useDiscoverySummary(["store"], { enabled: visible });
	const storeCount = visible ? getSectionCount(summary, "store") : 0;

	async function loadBalance() {
		if (!visible) {
			return;
		}
		try {
			const response = await dedupedFetch("/api/store?brief=1", {
				cache: "no-store",
			});
			if (!response.ok) {
				return;
			}
			const payload = (await response.json()) as { balance?: number };
			setBalance(
				typeof payload.balance === "number"
					? Math.max(0, payload.balance)
					: 0,
			);
		} catch {
			// Ignore header coin refresh failures.
		}
	}

	useEffect(() => {
		void loadBalance();
	}, [visible]);

	useEffect(() => {
		function onWalletRefresh() {
			void loadBalance();
		}
		window.addEventListener("wallet:refresh", onWalletRefresh);
		return () => {
			window.removeEventListener("wallet:refresh", onWalletRefresh);
		};
	}, [visible]);

	if (!visible) {
		return null;
	}

	return (
		<Link
			href="/store"
			className="store-link-chip"
			style={{ position: "relative" }}
			aria-label="Open store"
			title="Store">
			<CoinIcon size={11} />
			<span className="store-link-balance">{formatCompactBalance(balance)}</span>
			<DiscoveryBadge count={storeCount} variant="absolute" />
		</Link>
	);
}


