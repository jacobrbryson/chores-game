import { io, Socket } from "socket.io-client";

let socket: Socket | null = null;
let identifiedUid = "";
let identifiedFamilyKey = "";
let pendingIdentity: { uid: string; familyIds: string[] } | null = null;
let connectHandlerBound = false;

export type FamilyActivityEvent = {
	type: "chore_completed" | "chore_created" | "chore_updated" | "chore_deleted";
	familyId: string;
	choreId?: string;
	occurredAt: string;
};

export function getSocket() {
	if (socket) return socket;

	socket = io(process.env.NEXT_PUBLIC_WS_URL ?? "http://localhost:3001", {
		transports: ["websocket"],
		autoConnect: false,
	});

	if (!connectHandlerBound) {
		connectHandlerBound = true;
		socket.on("connect", () => {
			if (!pendingIdentity) {
				return;
			}
			socket?.emit("auth:identify", pendingIdentity);
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
		client.connect();
		return client;
	}

	if (pendingIdentity) {
		client.emit("auth:identify", pendingIdentity);
	}
	return client;
}
