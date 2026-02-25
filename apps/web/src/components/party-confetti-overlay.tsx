"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import {
	PARTY_CONFETTI_SELECTION_CHANGED_EVENT,
	PARTY_CONFETTI_TRIGGER_EVENT,
	type PartyConfettiSelectionDetail,
	type PartyConfettiTriggerDetail,
	normalizeConfettiOptionId,
	readStoredConfettiOptionId,
	writeStoredConfettiOptionId,
} from "@/lib/confetti/party";
import { findConfettiOptionById } from "@/lib/store/catalog";

type PartyConfettiOverlayProps = {
	defaultDurationMs?: number;
	maxDurationMs?: number;
};

type ConfettiLaunchMode =
	| "fall"
	| "rise"
	| "corner"
	| "click"
	| "spontaneous";

type ConfettiEmitter = {
	mode: ConfettiLaunchMode;
	weight: number;
	originX: number;
	originY: number;
	cornerSide?: "left" | "right";
};

type ConfettiPiece = {
	id: string;
	startX: number;
	startY: number;
	deltaX: number;
	deltaY: number;
	rotateStart: number;
	rotateEnd: number;
	size: number;
	stretch: number;
	delayMs: number;
	durationMs: number;
	color: string;
	shape: "rect" | "circle" | "streamer";
	opacity: number;
};

type ConfettiBurst = {
	id: string;
	pieces: ConfettiPiece[];
	glowColor: string;
	glowX: number;
	glowY: number;
	durationMs: number;
};

const STORE_BRIEF_PATH = "/api/store?brief=1";

function randomInRange(min: number, max: number) {
	return min + Math.random() * (max - min);
}

function clamp(value: number, min: number, max: number) {
	return Math.max(min, Math.min(max, value));
}

function pickRandom<T>(values: T[]) {
	return values[Math.floor(Math.random() * values.length)];
}

function normalizeDuration(value: number, maxDurationMs: number) {
	return clamp(Math.round(value), 460, maxDurationMs);
}

function normalizePointerPercent(point?: { x: number; y: number }) {
	if (!point) {
		return { x: 50, y: 50 };
	}
	return {
		x: clamp(point.x, 2, 98),
		y: clamp(point.y, 2, 98),
	};
}

function toViewportPercent(clientX: number, clientY: number) {
	if (typeof window === "undefined") {
		return { x: 50, y: 50 };
	}
	const width = Math.max(window.innerWidth || 1, 1);
	const height = Math.max(window.innerHeight || 1, 1);
	return normalizePointerPercent({
		x: (clientX / width) * 100,
		y: (clientY / height) * 100,
	});
}

function distributePieces(totalPieces: number, emitters: ConfettiEmitter[]) {
	const counts = emitters.map((entry) =>
		Math.max(1, Math.round(totalPieces * entry.weight)),
	);
	let currentTotal = counts.reduce((sum, value) => sum + value, 0);
	while (currentTotal > totalPieces) {
		const index = counts.findIndex((value) => value > 1);
		if (index === -1) {
			break;
		}
		counts[index] -= 1;
		currentTotal -= 1;
	}
	while (currentTotal < totalPieces) {
		const index = currentTotal % counts.length;
		counts[index] += 1;
		currentTotal += 1;
	}
	return counts;
}

function createPiece(
	options: {
		mode: ConfettiLaunchMode;
		emitter: ConfettiEmitter;
		durationMs: number;
		maxDurationMs: number;
		spread: number;
		colors: string[];
		shapes: Array<"rect" | "circle" | "streamer">;
		verticalDrift: number;
	},
	id: string,
) {
	const {
		mode,
		emitter,
		durationMs,
		maxDurationMs,
		spread,
		colors,
		shapes,
		verticalDrift,
	} = options;
	const shape = pickRandom(shapes);
	const driftScale = clamp(verticalDrift / 108, 0.72, 1.36);
	const baseSize = shape === "streamer" ? randomInRange(4.5, 7.5) : randomInRange(6, 12);
	const stretch =
		shape === "streamer"
			? randomInRange(2.2, 3.5)
			: shape === "rect"
				? randomInRange(0.78, 1.35)
				: 1;
	const rotateStart = randomInRange(-20, 380);
	const rotateEnd =
		rotateStart + randomInRange(280, 980) * (Math.random() > 0.5 ? 1 : -1);
	const delayMs = randomInRange(0, 125);
	const pieceDuration = normalizeDuration(
		durationMs + randomInRange(-110, 90),
		maxDurationMs,
	);
	const localSpread = Math.max(8, spread * 0.42);

	let startX = emitter.originX + randomInRange(-localSpread * 0.26, localSpread * 0.26);
	let startY = emitter.originY + randomInRange(-4, 4);
	let deltaX = randomInRange(-(spread * 0.68), spread * 0.68);
	let deltaY = randomInRange(82, 124) * driftScale;

	if (mode === "rise") {
		startY = clamp(emitter.originY + randomInRange(-2, 3), 88, 105);
		deltaX = randomInRange(-(spread * 0.5), spread * 0.5);
		deltaY = -randomInRange(38, 74) * driftScale;
	}
	if (mode === "corner") {
		const side = emitter.cornerSide ?? "left";
		startX = side === "left" ? randomInRange(-6, 10) : randomInRange(90, 106);
		startY = randomInRange(-6, 12);
		deltaX =
			side === "left"
				? randomInRange(14, Math.max(18, spread * 0.95))
				: -randomInRange(14, Math.max(18, spread * 0.95));
		deltaY = randomInRange(76, 116) * driftScale;
	}
	if (mode === "click") {
		startX = clamp(emitter.originX + randomInRange(-5.5, 5.5), 1, 99);
		startY = clamp(emitter.originY + randomInRange(-5, 5), 1, 99);
		deltaX = randomInRange(-spread * 0.95, spread * 0.95);
		deltaY = randomInRange(-52, 66) * driftScale;
	}
	if (mode === "spontaneous") {
		startX = randomInRange(8, 92);
		startY = randomInRange(12, 74);
		deltaX = randomInRange(-26, 26);
		deltaY = randomInRange(-30, 70) * driftScale;
	}

	return {
		id,
		startX: clamp(startX, -12, 112),
		startY: clamp(startY, -14, 106),
		deltaX,
		deltaY,
		rotateStart,
		rotateEnd,
		size: baseSize,
		stretch,
		delayMs,
		durationMs: pieceDuration,
		color: pickRandom(colors),
		shape,
		opacity: randomInRange(0.84, 1),
	} satisfies ConfettiPiece;
}

export function PartyConfettiOverlay({
	defaultDurationMs = 900,
	maxDurationMs = 1000,
}: PartyConfettiOverlayProps) {
	const [selectedOptionId, setSelectedOptionId] = useState(readStoredConfettiOptionId);
	const [bursts, setBursts] = useState<ConfettiBurst[]>([]);
	const burstSequenceRef = useRef(0);
	const timeoutHandlesRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
	const selectedOptionRef = useRef(selectedOptionId);
	const pointerRef = useRef<{ x: number; y: number }>({ x: 50, y: 50 });

	useEffect(() => {
		selectedOptionRef.current = selectedOptionId;
		writeStoredConfettiOptionId(selectedOptionId);
	}, [selectedOptionId]);

	useEffect(() => {
		function onPointerMove(event: PointerEvent) {
			pointerRef.current = toViewportPercent(event.clientX, event.clientY);
		}
		function onMouseDown(event: MouseEvent) {
			pointerRef.current = toViewportPercent(event.clientX, event.clientY);
		}
		window.addEventListener("pointermove", onPointerMove, { passive: true });
		window.addEventListener("mousedown", onMouseDown, { passive: true });
		return () => {
			window.removeEventListener("pointermove", onPointerMove);
			window.removeEventListener("mousedown", onMouseDown);
		};
	}, []);

	useEffect(() => {
		let cancelled = false;
		async function loadSelectionFromServer() {
			try {
				const response = await fetch(STORE_BRIEF_PATH, { cache: "no-store" });
				if (!response.ok || cancelled) {
					return;
				}
				const payload = (await response.json()) as { selectedConfettiOptionId?: unknown };
				if (cancelled) {
					return;
				}
				setSelectedOptionId(
					normalizeConfettiOptionId(payload.selectedConfettiOptionId),
				);
			} catch {
				// Keep local fallback.
			}
		}
		void loadSelectionFromServer();
		return () => {
			cancelled = true;
		};
	}, []);

	const triggerBurst = useCallback(
		(detail?: PartyConfettiTriggerDetail) => {
			const optionId = normalizeConfettiOptionId(
				detail?.optionId ?? selectedOptionRef.current,
			);
			const option = findConfettiOptionById(optionId);
			const preset = option?.confetti;
			if (!preset) {
				return;
			}
			const intensity = clamp(detail?.intensity ?? 1, 0.75, 2.25);
			const durationMs = normalizeDuration(
				detail?.durationMs ?? defaultDurationMs,
				maxDurationMs,
			);
			const spread = clamp(detail?.spread ?? preset.spread, 18, 60);
			const pieceCount = Math.round(
				clamp(detail?.particleCount ?? preset.density, 20, 176) * intensity,
			);
			const pointerOrigin =
				typeof detail?.sourceClientX === "number" &&
				typeof detail?.sourceClientY === "number"
					? toViewportPercent(detail.sourceClientX, detail.sourceClientY)
					: pointerRef.current;
			const clickOrigin = normalizePointerPercent(pointerOrigin);

			const emitters: ConfettiEmitter[] = [
				{
					mode: "fall",
					weight: 0.22,
					originX: randomInRange(34, 66),
					originY: randomInRange(-10, 6),
				},
				{
					mode: "rise",
					weight: 0.18,
					originX: randomInRange(18, 82),
					originY: randomInRange(96, 102),
				},
				{
					mode: "corner",
					weight: 0.14,
					originX: 0,
					originY: 0,
					cornerSide: "left",
				},
				{
					mode: "corner",
					weight: 0.14,
					originX: 100,
					originY: 0,
					cornerSide: "right",
				},
				{
					mode: "click",
					weight: 0.2,
					originX: clickOrigin.x,
					originY: clickOrigin.y,
				},
				{
					mode: "spontaneous",
					weight: 0.12,
					originX: randomInRange(10, 90),
					originY: randomInRange(16, 80),
				},
			];
			const pieceDistribution = distributePieces(pieceCount, emitters);

			const nextBursts = emitters.map((emitter, emitterIndex) => {
				burstSequenceRef.current += 1;
				const burstId = `burst-${Date.now()}-${burstSequenceRef.current}`;
				const emitterPieceCount = pieceDistribution[emitterIndex] ?? 1;
				const pieces: ConfettiPiece[] = Array.from(
					{ length: emitterPieceCount },
					(_unused, pieceIndex) =>
						createPiece(
							{
								mode: emitter.mode,
								emitter,
								durationMs,
								maxDurationMs,
								spread,
								colors: preset.colors,
								shapes: preset.shapes,
								verticalDrift: preset.verticalDrift,
							},
							`${burstId}-${pieceIndex}`,
						),
				);
				return {
					id: burstId,
					pieces,
					glowColor:
						preset.colors[emitterIndex % preset.colors.length] ?? "#ffffff",
					glowX: emitter.mode === "spontaneous" ? randomInRange(12, 88) : emitter.originX,
					glowY: emitter.mode === "spontaneous" ? randomInRange(16, 86) : emitter.originY,
					durationMs,
				} satisfies ConfettiBurst;
			});

			const burstIds = new Set(nextBursts.map((entry) => entry.id));
			setBursts((current) => [...current, ...nextBursts]);
			const timer = setTimeout(() => {
				setBursts((current) =>
					current.filter((entry) => !burstIds.has(entry.id)),
				);
			}, durationMs + 260);
			timeoutHandlesRef.current.push(timer);
		},
		[defaultDurationMs, maxDurationMs],
	);

	useEffect(() => {
		function onSelectionChanged(event: Event) {
			const customEvent = event as CustomEvent<PartyConfettiSelectionDetail>;
			setSelectedOptionId(normalizeConfettiOptionId(customEvent.detail?.optionId));
		}

		function onConfettiTrigger(event: Event) {
			const customEvent = event as CustomEvent<PartyConfettiTriggerDetail>;
			triggerBurst(customEvent.detail);
		}

		window.addEventListener(
			PARTY_CONFETTI_SELECTION_CHANGED_EVENT,
			onSelectionChanged as EventListener,
		);
		window.addEventListener(
			PARTY_CONFETTI_TRIGGER_EVENT,
			onConfettiTrigger as EventListener,
		);
		return () => {
			window.removeEventListener(
				PARTY_CONFETTI_SELECTION_CHANGED_EVENT,
				onSelectionChanged as EventListener,
			);
			window.removeEventListener(
				PARTY_CONFETTI_TRIGGER_EVENT,
				onConfettiTrigger as EventListener,
			);
		};
	}, [triggerBurst]);

	useEffect(() => {
		return () => {
			for (const handle of timeoutHandlesRef.current) {
				clearTimeout(handle);
			}
			timeoutHandlesRef.current = [];
		};
	}, []);

	if (bursts.length === 0) {
		return null;
	}

	return (
		<div className="party-confetti-layer" aria-hidden="true">
			{bursts.map((burst) => (
				<div key={burst.id} className="party-confetti-burst">
					<span
						className="party-confetti-glow"
						style={
							{
								"--party-glow-color": burst.glowColor,
								"--party-glow-x": `${burst.glowX}%`,
								"--party-glow-y": `${burst.glowY}%`,
								"--party-glow-duration": `${burst.durationMs}ms`,
							} as CSSProperties
						}
					/>
					{burst.pieces.map((piece) => (
						<span
							key={piece.id}
							className={`party-confetti-piece party-confetti-piece-${piece.shape}`}
							style={
								{
									left: `${piece.startX}%`,
									top: `${piece.startY}%`,
									"--party-piece-delta-x": `${piece.deltaX}vw`,
									"--party-piece-delta-y": `${piece.deltaY}vh`,
									"--party-piece-rotate-start": `${piece.rotateStart}deg`,
									"--party-piece-rotate-end": `${piece.rotateEnd}deg`,
									"--party-piece-size": `${piece.size}px`,
									"--party-piece-stretch": String(piece.stretch),
									"--party-piece-delay": `${piece.delayMs}ms`,
									"--party-piece-duration": `${piece.durationMs}ms`,
									"--party-piece-color": piece.color,
									"--party-piece-opacity": String(piece.opacity),
								} as CSSProperties
							}
						/>
					))}
				</div>
			))}
		</div>
	);
}
