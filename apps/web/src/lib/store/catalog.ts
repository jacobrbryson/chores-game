import { listPurchasableQuestItems } from "@/lib/items/catalog";

export type StoreCategoryId =
	| "customize_colors"
	| "customize_avatar"
	| "victory_confetti"
	| "family_awards"
	| "quest_items";

export type StoreOptionKind = "color" | "avatar" | "confetti" | "reward" | "quest_item";

export type ConfettiShape = "rect" | "circle" | "streamer";

export type ConfettiPreset = {
	colors: string[];
	shapes: ConfettiShape[];
	density: number;
	verticalDrift: number;
	spread: number;
};

export type ThemePalette = {
	primary: string;
	secondary: string;
	tertiary: string;
};

export type StoreOption = {
  id: string;
  label: string;
  value: string;
  itemId?: string;
	itemImage?: string;
	itemDescription?: string;
	itemPurchasable?: boolean;
	itemStackable?: boolean;
	itemConsumable?: boolean;
  itemUsableInQuests?: boolean;
  isPurchasable?: boolean;
  isUnlockable?: boolean;
  unlockSource?: "quest" | "store";
  unlockLabel?: string;
  requiredQuestId?: string;
  theme?: ThemePalette;
	confetti?: ConfettiPreset;
	isDefault?: boolean;
	price?: number;
};

export type StoreCategory = {
	id: StoreCategoryId;
	name: string;
	description: string;
	price: number;
	imagePath: string;
	kind: StoreOptionKind;
	options: StoreOption[];
};

export const DEFAULT_AVATAR_IDS = Array.from(
	{ length: 20 },
	(_value, index) => {
		const id = String(index + 1).padStart(2, "0");
		return `avatar-${id}.png`;
	},
);

export const DEFAULT_COLOR_THEME_OPTION_ID = "color_option_01";

const COLOR_OPTIONS: StoreOption[] = [
	{
		id: "color_option_01",
		label: "Cobalt Sky",
		value: "#0072b2",
		theme: {
			primary: "#0072b2",
			secondary: "#56b4e9",
			tertiary: "#1b2a41",
		},
	},
	{
		id: "color_option_02",
		label: "Amber Dawn",
		value: "#e69f00",
		theme: {
			primary: "#e69f00",
			secondary: "#88ccee",
			tertiary: "#4a3410",
		},
	},
	{
		id: "color_option_03",
		label: "Teal Harbor",
		value: "#009e73",
		theme: {
			primary: "#009e73",
			secondary: "#ddcc77",
			tertiary: "#123a38",
		},
	},
	{
		id: "color_option_04",
		label: "Ocean Night",
		value: "#332288",
		theme: {
			primary: "#332288",
			secondary: "#88ccee",
			tertiary: "#1a173b",
		},
	},
	{
		id: "color_option_05",
		label: "Lavender Field",
		value: "#aa4499",
		theme: {
			primary: "#aa4499",
			secondary: "#ddcc77",
			tertiary: "#3d1f45",
		},
	},
	{
		id: "color_option_06",
		label: "Vermillion Peak",
		value: "#d55e00",
		theme: {
			primary: "#d55e00",
			secondary: "#f0e442",
			tertiary: "#493218",
		},
	},
	{
		id: "color_option_07",
		label: "Rose Quartz",
		value: "#cc6677",
		theme: {
			primary: "#cc6677",
			secondary: "#44aa99",
			tertiary: "#3f2b35",
		},
	},
	{
		id: "color_option_08",
		label: "Emerald Grove",
		value: "#117733",
		theme: {
			primary: "#117733",
			secondary: "#cc79a7",
			tertiary: "#1f3528",
		},
	},
	{
		id: "color_option_09",
		label: "Olive Slate",
		value: "#999933",
		theme: {
			primary: "#999933",
			secondary: "#88ccee",
			tertiary: "#1f2a3a",
		},
	},
];

function assertUniqueColorThemePrimaries(options: StoreOption[]) {
	const primaryToOptionId = new Map<string, string>();
	for (const option of options) {
		if (!option.theme) {
			continue;
		}
		const normalizedPrimary = normalizeColor(option.theme.primary);
		const existingOptionId = primaryToOptionId.get(normalizedPrimary);
		if (existingOptionId) {
			throw new Error(
				`STORE_THEME_PRIMARY_DUPLICATE_${existingOptionId}_${option.id}`,
			);
		}
		primaryToOptionId.set(normalizedPrimary, option.id);
	}
}

assertUniqueColorThemePrimaries(COLOR_OPTIONS);

const AVATAR_OPTIONS: StoreOption[] = DEFAULT_AVATAR_IDS.slice(0, 9).map(
	(avatarId, index) => ({
		id: `avatar_option_${String(index + 1).padStart(2, "0")}`,
		label: index === 0 ? "Pip the Portal Pal" : `Avatar ${String(index + 1).padStart(2, "0")}`,
		value: avatarId,
		itemId: index === 0 ? "character_default_avatar_01" : undefined,
		isPurchasable: index === 0 ? false : true,
		isUnlockable: index === 0 ? true : undefined,
		unlockSource: index === 0 ? "quest" : undefined,
		unlockLabel: index === 0 ? "Quest Award" : undefined,
		requiredQuestId: index === 0 ? "template-quest-001" : undefined,
	}),
);

const CONFETTI_OPTIONS: StoreOption[] = [
	{
		id: "confetti_option_01",
		label: "No confetti",
		value: "confetti-off",
		isDefault: true,
	},
	{
		id: "confetti_option_02",
		label: "Starlight Burst",
		value: "confetti-starlight",
		confetti: {
			colors: ["#facc15", "#38bdf8", "#f472b6", "#a78bfa"],
			shapes: ["rect", "circle"],
			density: 86,
			verticalDrift: 108,
			spread: 36,
		},
	},
	{
		id: "confetti_option_03",
		label: "Ocean Pop",
		value: "confetti-ocean",
		confetti: {
			colors: ["#0ea5e9", "#22d3ee", "#2dd4bf", "#93c5fd"],
			shapes: ["rect", "streamer"],
			density: 82,
			verticalDrift: 112,
			spread: 42,
		},
	},
	{
		id: "confetti_option_04",
		label: "Sunset Spark",
		value: "confetti-sunset",
		confetti: {
			colors: ["#f97316", "#fb7185", "#f59e0b", "#f43f5e"],
			shapes: ["rect", "circle", "streamer"],
			density: 90,
			verticalDrift: 110,
			spread: 44,
		},
	},
	{
		id: "confetti_option_05",
		label: "Mint Flash",
		value: "confetti-mint",
		confetti: {
			colors: ["#10b981", "#5eead4", "#84cc16", "#14b8a6"],
			shapes: ["circle", "streamer"],
			density: 80,
			verticalDrift: 106,
			spread: 34,
		},
	},
	{
		id: "confetti_option_06",
		label: "Royal Parade",
		value: "confetti-royal",
		confetti: {
			colors: ["#4f46e5", "#7c3aed", "#ec4899", "#fde047"],
			shapes: ["rect", "streamer"],
			density: 92,
			verticalDrift: 118,
			spread: 48,
		},
	},
	{
		id: "confetti_option_07",
		label: "Cotton Party",
		value: "confetti-cotton",
		confetti: {
			colors: ["#f9a8d4", "#fdba74", "#fde68a", "#c4b5fd"],
			shapes: ["circle", "rect"],
			density: 78,
			verticalDrift: 104,
			spread: 30,
		},
	},
	{
		id: "confetti_option_08",
		label: "Neon Pulse",
		value: "confetti-neon",
		confetti: {
			colors: ["#22c55e", "#eab308", "#06b6d4", "#f43f5e"],
			shapes: ["rect", "streamer", "circle"],
			density: 96,
			verticalDrift: 122,
			spread: 52,
		},
	},
	{
		id: "confetti_option_09",
		label: "Midnight Nova",
		value: "confetti-midnight",
		confetti: {
			colors: ["#60a5fa", "#818cf8", "#a78bfa", "#f472b6"],
			shapes: ["rect", "circle"],
			density: 88,
			verticalDrift: 116,
			spread: 40,
		},
	},
];

export const DEFAULT_CONFETTI_OPTION_ID = "confetti_option_01";

const QUEST_ITEM_OPTIONS: StoreOption[] = listPurchasableQuestItems().map((item) => ({
	id: item.id,
	label: item.name,
	value: item.id,
	itemId: item.id,
	itemImage: item.image,
	itemDescription: item.description,
	itemPurchasable: item.purchasable,
	itemStackable: item.stackable,
	itemConsumable: item.consumable,
	itemUsableInQuests: item.usableInQuests,
	price: item.price,
}));

export const STORE_CATEGORIES: StoreCategory[] = [
	{
		id: "customize_colors",
		name: "Customize colors",
		description: "Buy color themes for your dashboard.",
		price: 30,
		imagePath: "/store3/theme.png",
		kind: "color",
		options: COLOR_OPTIONS,
	},
	{
		id: "customize_avatar",
		name: "Customize avatar",
		description: "Buy avatars from the default avatar pack.",
		price: 50,
		imagePath: "/store3/avatar.png",
		kind: "avatar",
		options: AVATAR_OPTIONS,
	},
	{
		id: "victory_confetti",
		name: "Victory confetti",
		description: "Buy confetti celebration styles.",
		price: 20,
		imagePath: "/store3/confetti.png",
		kind: "confetti",
		options: CONFETTI_OPTIONS,
	},
	{
		id: "quest_items",
		name: "Quest Items",
		description: "Items you can buy and use inside story quests.",
		price: 0,
		imagePath: "/store3/theme.png",
		kind: "quest_item",
		options: QUEST_ITEM_OPTIONS,
	},
];

export function isStoreCategoryId(
	value: string,
): value is StoreCategoryId {
	return (
		value === "customize_colors" ||
		value === "customize_avatar" ||
		value === "victory_confetti" ||
		value === "family_awards" ||
		value === "quest_items"
	);
}

export function findStoreCategoryById(id: string) {
	return STORE_CATEGORIES.find((category) => category.id === id) ?? null;
}

export function findStoreOptionById(optionId: string) {
	for (const category of STORE_CATEGORIES) {
		const option = category.options.find((entry) => entry.id === optionId);
		if (option) {
			return { category, option };
		}
	}
	return null;
}

export function findStoreOptionByValue(
	categoryId: StoreCategoryId,
	value: string,
) {
	const category = findStoreCategoryById(categoryId);
	if (!category) {
		return null;
	}
	return category.options.find((entry) => entry.value === value) ?? null;
}

export function findColorThemeOptionById(
	optionId: string,
): (StoreOption & { theme: ThemePalette }) | null {
	const category = findStoreCategoryById("customize_colors");
	if (!category) {
		return null;
	}
	const option = category.options.find((entry) => entry.id === optionId);
	if (!option || !option.theme) {
		return null;
	}
	return { ...option, theme: option.theme };
}

export function findConfettiOptionById(optionId: string) {
	const category = findStoreCategoryById("victory_confetti");
	if (!category) {
		return null;
	}
	return category.options.find((entry) => entry.id === optionId) ?? null;
}

export function isAllowedDashboardColor(value: string) {
	return /^#[0-9a-fA-F]{6}$/.test(value);
}

export function normalizeColor(value: string) {
	return value.trim().toLowerCase();
}

export function normalizeThemePalette(palette: ThemePalette): ThemePalette {
	return {
		primary: normalizeColor(palette.primary),
		secondary: normalizeColor(palette.secondary),
		tertiary: normalizeColor(palette.tertiary),
	};
}

export function isValidThemePalette(value: unknown): value is ThemePalette {
	if (!value || typeof value !== "object") {
		return false;
	}
	const palette = value as ThemePalette;
	return (
		isAllowedDashboardColor(palette.primary) &&
		isAllowedDashboardColor(palette.secondary) &&
		isAllowedDashboardColor(palette.tertiary)
	);
}
