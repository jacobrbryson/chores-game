export type StoreItemId = "customize_colors" | "customize_avatar" | "victory_confetti";

export type StoreItem = {
  id: StoreItemId;
  name: string;
  description: string;
  price: number;
};

export const STORE_ITEMS: StoreItem[] = [
  {
    id: "customize_colors",
    name: "Customize colors",
    description: "Unlock dashboard primary color customization.",
    price: 30,
  },
  {
    id: "customize_avatar",
    name: "Customize avatar",
    description: "Unlock avatar selection from default avatar pack.",
    price: 50,
  },
  {
    id: "victory_confetti",
    name: "Victory confetti",
    description: "Unlock celebratory confetti theme accents.",
    price: 20,
  },
];

export const DEFAULT_DASHBOARD_COLORS = [
  "#1f78d1",
  "#20a987",
  "#de6b48",
  "#6a64cf",
  "#cc4f7a",
  "#9c7f1f",
  "#0f766e",
  "#b45309",
  "#0f4c81",
  "#be185d",
];

export const DEFAULT_AVATAR_IDS = Array.from({ length: 20 }, (_value, index) => {
  const id = String(index + 1).padStart(2, "0");
  return `avatar-${id}.png`;
});

export function isStoreItemId(value: string): value is StoreItemId {
  return value === "customize_colors" || value === "customize_avatar" || value === "victory_confetti";
}

export function findStoreItemById(id: string) {
  return STORE_ITEMS.find((item) => item.id === id) ?? null;
}

export function isAllowedDashboardColor(value: string) {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

export function normalizeColor(value: string) {
  return value.trim().toLowerCase();
}
