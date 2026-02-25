import { io, Socket } from "socket.io-client";
import type { FamilyActivityEvent } from "@/lib/ws/family-activity-event";

let socket: Socket | null = null;
let identifiedAuthToken = "";
let pendingIdentity: { authToken: string } | null = null;
let connectHandlerBound = false;
export type { FamilyActivityEvent };

export function getSocket() {
	if (socket) return socket;

	const wsUrl = (process.env.NEXT_PUBLIC_WS_URL ?? "http://localhost:3001").trim();
	socket = io(wsUrl, {
		// Use polling only to avoid noisy websocket probe failures behind managed edges.
		transports: ["polling"],
		upgrade: false,
		withCredentials: true,
		autoConnect: false,
		timeout: 5000,
		reconnectionAttempts: 20,
		reconnectionDelay: 1000,
		reconnectionDelayMax: 10_000,
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

export function connectFamilySocket(params: { authToken: string }) {
	const authToken = params.authToken.trim();
	if (!authToken) {
		return null;
	}

	const client = getSocket();
	const shouldIdentify = identifiedAuthToken !== authToken;
	if (shouldIdentify) {
		identifiedAuthToken = authToken;
		pendingIdentity = { authToken };
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
