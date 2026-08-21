import { io, type Socket } from "socket.io-client";

export type FamilyActivityEvent = {
  familyId: string;
  choreId?: string;
  type?: string;
};

// Emitted by the WS server when a player crosses an achievement target. Mirrors
// apps/ws/src/achievement-unlocked-event.ts and the web listener's payload.
export type AchievementUnlockedEvent = {
  type: "achievement:unlocked";
  achievementId: string;
  title: string;
  wittyTitle: string;
  description: string;
  imageUrl: string;
  completedAt: string;
  userId: string;
  familyId: string;
};

let socket: Socket | null = null;
let identifiedAuthToken = "";
let pendingIdentity: { authToken: string } | null = null;
let connectHandlerBound = false;

function getSocket() {
  if (socket) {
    return socket;
  }

  const wsUrl = (process.env.EXPO_PUBLIC_WS_URL ?? "http://localhost:3001").trim();
  socket = io(wsUrl, {
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
