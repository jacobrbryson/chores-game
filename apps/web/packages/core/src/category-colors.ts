// Chip colours offered when creating or editing a chore Category. Shared so the
// web Manage Family page and the mobile Manage Family screen offer the exact
// same palette — a category created on one platform must render identically on
// the other.
export const CATEGORY_COLOR_PALETTE: string[] = [
  // Reds
  "#ef4444", "#dc2626", "#b91c1c", "#991b1b",
  // Oranges
  "#f97316", "#ea580c", "#c2410c", "#fb923c",
  // Yellows / Ambers
  "#f59e0b", "#d97706", "#b45309", "#fbbf24",
  // Limes / Greens
  "#84cc16", "#65a30d", "#16a34a", "#15803d",
  // Teals / Cyans
  "#14b8a6", "#0d9488", "#06b6d4", "#0891b2",
  // Blues
  "#3b82f6", "#2563eb", "#1d4ed8", "#1e40af",
  // Indigos
  "#6366f1", "#4f46e5", "#4338ca", "#3730a3",
  // Violets / Purples
  "#8b5cf6", "#7c3aed", "#6d28d9", "#a855f7",
  // Pinks / Roses
  "#ec4899", "#db2777", "#be185d", "#f472b6",
  // Roses
  "#f43f5e", "#e11d48", "#be123c", "#fb7185",
  // Emeralds
  "#10b981", "#059669", "#047857", "#34d399",
  // Sky
  "#0ea5e9", "#0284c7", "#0369a1", "#38bdf8",
  // Slates / Grays
  "#64748b", "#475569", "#334155", "#1e293b",
  // Stone / Warmth
  "#78716c", "#57534e", "#44403c", "#a8a29e",
  // Warm accents
  "#d946ef", "#c026d3", "#a21caf", "#e879f9",
  // Additional warm neutrals
  "#f87171", "#fca5a5", "#86efac", "#93c5fd",
];

export const CATEGORY_COLOR_FALLBACK = "#64748b";
export const MAX_CATEGORY_NAME_LENGTH = 40;

export function normalizeCategoryName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeCategoryColor(value: string) {
  return value.trim().toLowerCase();
}

export function isValidCategoryColor(value: string) {
  return /^#[0-9a-f]{6}$/.test(value);
}
