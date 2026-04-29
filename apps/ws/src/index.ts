import { createServer, type ServerResponse } from "node:http";
import { Server } from "socket.io";
import {
	type FamilyActivityEvent,
	isFamilyActivityType,
} from "./family-activity-event.js";
import { verifyFamilySocketAuthToken } from "./family-auth-token.js";
import {
	type AchievementUnlockedEvent,
	isAchievementUnlockedEvent,
} from "./achievement-unlocked-event.js";

const PORT = Number(process.env.PORT ?? 3001);
const isProduction = process.env.NODE_ENV === "production";
const rawOrigins = process.env.WS_ORIGIN ?? "http://localhost:3000";
const INTERNAL_SECRET =
	process.env.WS_INTERNAL_SECRET ?? (isProduction ? "" : "dev-ws-internal-secret");

function normalizeOrigin(value: string) {
	return value.trim().replace(/\/+$/, "");
}

const allowedOrigins = new Set(
	rawOrigins
		.split(",")
		.map((entry) => normalizeOrigin(entry))
		.filter((entry) => entry.length > 0),
);
const allowAllOrigins = allowedOrigins.has("*");

if (isProduction && allowedOrigins.size === 0) {
	throw new Error("WS_ORIGIN env var is required for websocket CORS in production.");
}
if (!INTERNAL_SECRET) {
	throw new Error("WS_INTERNAL_SECRET env var is required for internal publish auth.");
}

const httpServer = createServer();
const io = new Server(httpServer, {
	cors: {
		origin: (origin, callback) => {
			if (!origin) {
				callback(null, !isProduction);
				return;
			}
			const normalizedOrigin = normalizeOrigin(origin);
			const allowed = allowAllOrigins || allowedOrigins.has(normalizedOrigin);
			callback(null, allowed);
		},
		methods: ["GET", "POST"],
		credentials: true,
	},
});

function sendJson(res: ServerResponse, status: number, body: Record<string, unknown>) {
	res.statusCode = status;
	res.setHeader("Content-Type", "application/json");
	res.end(JSON.stringify(body));
}

httpServer.on("request", (req, res) => {
	if (
		req.method !== "POST" ||
		(req.url !== "/events/family-activity" &&
			req.url !== "/events/achievement-unlocked")
	) {
		return;
	}

	const authHeader = req.headers.authorization ?? "";
	if (authHeader !== `Bearer ${INTERNAL_SECRET}`) {
		sendJson(res, 401, { error: "unauthorized" });
		return;
	}

	let raw = "";
	req.on("data", (chunk) => {
		raw += String(chunk);
		if (raw.length > 100_000) {
			req.destroy();
		}
	});

	req.on("end", () => {
		try {
			if (req.url === "/events/family-activity") {
				const parsed = JSON.parse(raw) as Partial<FamilyActivityEvent>;
				if (!parsed.familyId || !isFamilyActivityType(parsed.type)) {
					sendJson(res, 400, { error: "invalid_payload" });
					return;
				}
				const payload: FamilyActivityEvent = {
					type: parsed.type,
					familyId: parsed.familyId,
					choreId: parsed.choreId ?? "",
					occurredAt: parsed.occurredAt ?? new Date().toISOString(),
				};
				io.to(`family:${payload.familyId}`).emit("family:activity", payload);
			} else {
				const parsed = JSON.parse(raw) as Partial<AchievementUnlockedEvent>;
				if (!isAchievementUnlockedEvent(parsed)) {
					sendJson(res, 400, { error: "invalid_payload" });
					return;
				}
				io.to(`user:${parsed.userId}`).emit("achievement:unlocked", parsed);
				io.to(`family:${parsed.familyId}`).emit("achievement:unlocked", parsed);
			}
			sendJson(res, 200, { ok: true });
		} catch {
			sendJson(res, 400, { error: "invalid_json" });
		}
	});
});

io.on("connection", (socket) => {
	socket.on(
		"auth:identify",
		(payload: { authToken?: string }) => {
			const claims = verifyFamilySocketAuthToken(payload.authToken, INTERNAL_SECRET);
			if (!claims) {
				socket.emit("auth:error", { error: "invalid_auth_token" });
				return;
			}
			socket.data.uid = claims.uid;

			for (const familyId of claims.familyIds) {
				socket.join(`family:${familyId}`);
			}

			socket.join(`user:${claims.uid}`);

			socket.emit("auth:ok");
		},
	);
});

httpServer.listen(PORT);
