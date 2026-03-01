import { type CSSProperties } from "react";

type CoinIconProps = {
  className?: string;
  size?: number;
  ariaHidden?: boolean;
};

function joinClasses(...classes: Array<string | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function CoinIcon({ className, size = 18, ariaHidden = true }: CoinIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={joinClasses("coin-icon", className)}
      style={{ "--coin-size": `${size}px` } as CSSProperties}
      aria-hidden={ariaHidden}
      focusable="false">
      <circle cx="12" cy="12" r="10.5" fill="#f59e0b" />
      <circle cx="12" cy="12" r="8.7" fill="#fbbf24" />
      <circle cx="12" cy="12" r="7.2" fill="#fcd34d" />
      <circle cx="12" cy="12" r="5.1" fill="#f59e0b" opacity="0.25" />
      <text
        x="12"
        y="15"
        textAnchor="middle"
        fill="#b45309"
        fontSize="9.2"
        fontWeight="800"
        fontFamily="'Trebuchet MS', 'Segoe UI', Arial, sans-serif">
        $
      </text>
    </svg>
  );
}
