"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type HeaderStoreLinkProps = {
  visible: boolean;
};

export function HeaderStoreLink({ visible }: HeaderStoreLinkProps) {
  const [balance, setBalance] = useState(0);

  async function loadBalance() {
    if (!visible) {
      return;
    }
    try {
      const response = await fetch("/api/store?brief=1", { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      const payload = (await response.json()) as { balance?: number };
      setBalance(typeof payload.balance === "number" ? Math.max(0, payload.balance) : 0);
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
    <Link href="/store" className="store-link-chip">
      <span aria-hidden="true">&#x1FA99;</span>
      <span>{balance}</span>
      <span className="store-link-label">Store</span>
    </Link>
  );
}
