export type StoreCategoryId =
	| "customize_colors"
	| "customize_avatar"
	| "victory_confetti";

export type StoreOptionKind = "color" | "avatar" | "confetti";

export type StoreOption = {
	id: string;
	label: string;
	value: string;
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

const COLOR_OPTIONS: StoreOption[] = [
	{ id: "color_option_01", label: "Sky Blue", value: "#1f78d1" },
	{ id: "color_option_02", label: "Aqua Mint", value: "#20a987" },
	{ id: "color_option_03", label: "Sunset Orange", value: "#de6b48" },
	{ id: "color_option_04", label: "Indigo Pop", value: "#6a64cf" },
	{ id: "color_option_05", label: "Berry Pink", value: "#cc4f7a" },
	{ id: "color_option_06", label: "Golden Olive", value: "#9c7f1f" },
	{ id: "color_option_07", label: "Deep Teal", value: "#0f766e" },
	{ id: "color_option_08", label: "Amber Glow", value: "#b45309" },
	{ id: "color_option_09", label: "Ocean Navy", value: "#0f4c81" },
];

const AVATAR_OPTIONS: StoreOption[] = DEFAULT_AVATAR_IDS.slice(0, 9).map(
	(avatarId, index) => ({
		id: `avatar_option_${String(index + 1).padStart(2, "0")}`,
		label: `Avatar ${String(index + 1).padStart(2, "0")}`,
		value: avatarId,
	}),
);

const CONFETTI_OPTIONS: StoreOption[] = Array.from(
	{ length: 9 },
	(_value, index) => {
		const order = String(index + 1).padStart(2, "0");
		return {
			id: `confetti_option_${order}`,
			label: `Confetti ${order}`,
			value: `confetti-${order}`,
		};
	},
);

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
];

export function isStoreCategoryId(
	value: string,
): value is StoreCategoryId {
	return (
		value === "customize_colors" ||
		value === "customize_avatar" ||
		value === "victory_confetti"
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

export function isAllowedDashboardColor(value: string) {
	return /^#[0-9a-fA-F]{6}$/.test(value);
}

export function normalizeColor(value: string) {
	return value.trim().toLowerCase();
}
