import {
	DEFAULT_CONFETTI_OPTION_ID,
	findConfettiOptionById,
} from "@/lib/store/catalog";

export const PARTY_CONFETTI_TRIGGER_EVENT = "party-confetti:trigger";
export const PARTY_CONFETTI_SELECTION_CHANGED_EVENT =
	"party-confetti:selection-changed";
export const PARTY_CONFETTI_STORAGE_KEY = "preferences_confetti_option_v1";

export type PartyConfettiTriggerDetail = {
	optionId?: string;
	particleCount?: number;
	durationMs?: number;
	intensity?: number;
	spread?: number;
	sourceClientX?: number;
	sourceClientY?: number;
};

export type PartyConfettiSelectionDetail = {
	optionId: string;
};

export function normalizeConfettiOptionId(value: unknown) {
	if (typeof value !== "string") {
		return DEFAULT_CONFETTI_OPTION_ID;
	}
	const normalized = value.trim();
	if (!normalized) {
		return DEFAULT_CONFETTI_OPTION_ID;
	}
	return findConfettiOptionById(normalized)
		? normalized
		: DEFAULT_CONFETTI_OPTION_ID;
}

export function readStoredConfettiOptionId() {
	if (typeof window === "undefined") {
		return DEFAULT_CONFETTI_OPTION_ID;
	}
	try {
		const value = window.localStorage.getItem(PARTY_CONFETTI_STORAGE_KEY);
		return normalizeConfettiOptionId(value);
	} catch {
		return DEFAULT_CONFETTI_OPTION_ID;
	}
}

export function writeStoredConfettiOptionId(optionId: string) {
	if (typeof window === "undefined") {
		return;
	}
	try {
		window.localStorage.setItem(
			PARTY_CONFETTI_STORAGE_KEY,
			normalizeConfettiOptionId(optionId),
		);
	} catch {
		// Ignore localStorage errors.
	}
}

export function dispatchConfettiSelectionChanged(optionId: string) {
	if (typeof window === "undefined") {
		return;
	}
	const normalized = normalizeConfettiOptionId(optionId);
	writeStoredConfettiOptionId(normalized);
	window.dispatchEvent(
		new CustomEvent<PartyConfettiSelectionDetail>(
			PARTY_CONFETTI_SELECTION_CHANGED_EVENT,
			{
				detail: { optionId: normalized },
			},
		),
	);
}

export function triggerPartyConfetti(detail: PartyConfettiTriggerDetail = {}) {
	if (typeof window === "undefined") {
		return;
	}
	const nextDetail: PartyConfettiTriggerDetail = {
		...detail,
		optionId:
			typeof detail.optionId === "string"
				? normalizeConfettiOptionId(detail.optionId)
				: undefined,
	};
	window.dispatchEvent(
		new CustomEvent<PartyConfettiTriggerDetail>(PARTY_CONFETTI_TRIGGER_EVENT, {
			detail: nextDetail,
		}),
	);
}
