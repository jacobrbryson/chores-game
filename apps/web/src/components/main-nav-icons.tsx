import { CoinIcon } from "@/components/coin-icon";
import type { MainNavigationIcon } from "@packages/core/src/main-navigation";

export function MainNavIcon({ icon }: { icon: MainNavigationIcon }) {
  if (icon === "coin") {
    return <CoinIcon size={22} className="main-nav-coin" />;
  }

  if (icon === "trophy") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M8 5.25h8v3a4 4 0 1 1-8 0v-3Z"
          fill="#fcd34d"
          stroke="#92400e"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.5"
        />
        <path
          d="M4.5 6.25h3.5v2a3 3 0 0 1-3.5-3v1Zm15 0H16v2a3 3 0 0 0 3.5-3v1Z"
          fill="none"
          stroke="#92400e"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
        <path d="M12 12.5v3.25M9.5 18.5h5" fill="none" stroke="#92400e" strokeLinecap="round" strokeWidth="1.8" />
      </svg>
    );
  }

  if (icon === "shield") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M12 3.75 5.25 6.8v5.1c0 3.95 2.7 7.35 6.75 8.35 4.05-1 6.75-4.4 6.75-8.35V6.8L12 3.75Z"
          fill="#d9f99d"
          stroke="#3f6212"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.5"
        />
        <path
          d="M9.1 8.25 12 11.15l2.9-2.9M12 11.2v5.2"
          fill="none"
          stroke="#3f6212"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M5 7h14M5 12h14M5 17h14"
        fill="none"
        stroke="#1d4ed8"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.9"
      />
      <path
        d="m6.5 7 1 1 1.8-2M6.5 12l1 1 1.8-2M6.5 17l1 1 1.8-2"
        fill="none"
        stroke="#16a34a"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
  );
}
