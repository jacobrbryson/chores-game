"use client";

type EnumChipTone =
  | "slate"
  | "blue"
  | "indigo"
  | "green"
  | "teal"
  | "amber"
  | "rose"
  | "violet";

type EnumChipProps = {
  label: string;
  tone?: EnumChipTone;
  className?: string;
};

export function humanizeEnum(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

export function EnumChip({ label, tone = "slate", className = "" }: EnumChipProps) {
  return <span className={`enum-chip enum-chip-${tone}${className ? ` ${className}` : ""}`}>{label}</span>;
}
