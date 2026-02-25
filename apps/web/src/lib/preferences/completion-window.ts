export type CompletionWindow = "today" | "week" | "month" | "year";

export const COMPLETION_WINDOW_VALUES: CompletionWindow[] = [
  "today",
  "week",
  "month",
  "year",
];

export function parseCompletionWindow(value: unknown): CompletionWindow | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "today" ||
    normalized === "week" ||
    normalized === "month" ||
    normalized === "year"
  ) {
    return normalized;
  }
  return null;
}

