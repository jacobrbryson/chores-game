import { io, Socket } from "socket.io-client";

let socket: Socket | null = null;
let identifiedUid = "";
let identifiedFamilyKey = "";
let pendingIdentity: { uid: string; familyIds: string[] } | null = null;
let connectHandlerBound = false;
let cachedWsUrl = "";

export type FamilyActivityEvent = {
	type: "chore_completed" | "chore_created" | "chore_updated" | "chore_deleted";
	familyId: string;
	choreId?: string;
	occurredAt: string;
};

export function getSocket() {
	if (socket) return socket;

	const wsUrl = (process.env.NEXT_PUBLIC_WS_URL ?? "http://localhost:3001").trim();
	cachedWsUrl = wsUrl;
	console.log("[WS_DEBUG] creating socket client", { wsUrl });
	socket = io(wsUrl, {
		transports: ["websocket"],
		autoConnect: false,
		timeout: 5000,
		reconnectionAttempts: 4,
	});

	function normalizeConnectError(error: unknown) {
		const maybeError = error as Error & {
			description?: unknown;
			context?: unknown;
			type?: string;
			code?: string | number;
		};
		const description = maybeError.description as
			| undefined
			| { message?: string; type?: string; target?: { url?: string; readyState?: number } };
		return {
			name: maybeError?.name || null,
			message: maybeError?.message || null,
			type: maybeError?.type || description?.type || null,
			code: maybeError?.code ?? null,
			descriptionMessage: description?.message ?? null,
			descriptionType: description?.type ?? null,
			descriptionUrl: description?.target?.url ?? null,
			descriptionReadyState: description?.target?.readyState ?? null,
			context: maybeError?.context ?? null,
			wsUrl: cachedWsUrl || null,
		};
	}

	if (!connectHandlerBound) {
		connectHandlerBound = true;
		socket.on("connect", () => {
			console.log("[WS_DEBUG] socket connected", { socketId: socket?.id ?? null });
			if (!pendingIdentity) {
				console.warn("[WS_DEBUG] socket connected without pending identity");
				return;
			}
			console.log("[WS_DEBUG] sending auth identity", pendingIdentity);
			socket?.emit("auth:identify", pendingIdentity);
		});
		socket.on("auth:ok", () => {
			console.log("[WS_DEBUG] auth acknowledged by server");
		});
		socket.on("connect_error", (error) => {
			console.error("[WS_DEBUG] socket connect_error", normalizeConnectError(error));
		});
		socket.on("disconnect", (reason) => {
			console.warn("[WS_DEBUG] socket disconnected", { reason });
		});
	}

	return socket;
}

export function connectFamilySocket(params: { uid: string; familyIds: string[] }) {
	const normalizedFamilyIds = Array.from(
		new Set(params.familyIds.map((entry) => entry.trim()).filter((entry) => entry.length > 0)),
	).sort();
	const familyKey = normalizedFamilyIds.join(",");
	if (!params.uid || normalizedFamilyIds.length === 0) {
		console.warn("[WS_DEBUG] skipping socket connect due to missing identity", {
			uid: params.uid,
			familyIds: normalizedFamilyIds,
		});
		return null;
	}

	const client = getSocket();
	const shouldIdentify = identifiedUid !== params.uid || identifiedFamilyKey !== familyKey;
	if (shouldIdentify) {
		identifiedUid = params.uid;
		identifiedFamilyKey = familyKey;
		pendingIdentity = { uid: params.uid, familyIds: normalizedFamilyIds };
	}

	if (!client.connected) {
		console.log("[WS_DEBUG] connecting websocket", {
			uid: params.uid,
			familyIds: normalizedFamilyIds,
		});
		client.connect();
		return client;
	}

	if (pendingIdentity) {
		client.emit("auth:identify", pendingIdentity);
	}
	return client;
}
