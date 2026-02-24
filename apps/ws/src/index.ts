import { createServer, type ServerResponse } from "node:http";
import { Server } from "socket.io";

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
const WS_DEBUG = process.env.WS_DEBUG === "1";

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
				if (WS_DEBUG) {
					console.log("[WS_DEBUG] cors check with empty origin", { allow: !isProduction });
				}
				callback(null, !isProduction);
				return;
			}
			const normalizedOrigin = normalizeOrigin(origin);
			const allowed = allowAllOrigins || allowedOrigins.has(normalizedOrigin);
			if (WS_DEBUG) {
				console.log("[WS_DEBUG] cors origin check", {
					origin,
					normalizedOrigin,
					allowed,
					allowAllOrigins,
				});
			}
			callback(null, allowed);
		},
		methods: ["GET", "POST"],
		credentials: true,
	},
	transports: ["websocket"],
});

type FamilyActivityEvent = {
	type: "chore_completed" | "chore_created" | "chore_updated" | "chore_deleted";
	familyId: string;
	choreId?: string;
	occurredAt: string;
};

function isFamilyActivityType(value: unknown): value is FamilyActivityEvent["type"] {
	return (
		value === "chore_completed" ||
		value === "chore_created" ||
		value === "chore_updated" ||
		value === "chore_deleted"
	);
}

function sendJson(res: ServerResponse, status: number, body: Record<string, unknown>) {
	res.statusCode = status;
	res.setHeader("Content-Type", "application/json");
	res.end(JSON.stringify(body));
}

httpServer.on("request", (req, res) => {
	if (req.method !== "POST" || req.url !== "/events/family-activity") {
		return;
	}

	const authHeader = req.headers.authorization ?? "";
	if (authHeader !== `Bearer ${INTERNAL_SECRET}`) {
		if (WS_DEBUG) {
			console.warn("[WS_DEBUG] publish unauthorized", {
				path: req.url,
				method: req.method,
				hasAuthHeader: Boolean(authHeader),
			});
		}
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
			if (WS_DEBUG) {
				console.log("[WS_DEBUG] publishing family activity", payload);
			}
			io.to(`family:${payload.familyId}`).emit("family:activity", payload);
			sendJson(res, 200, { ok: true });
		} catch {
			if (WS_DEBUG) {
				console.warn("[WS_DEBUG] invalid publish payload json");
			}
			sendJson(res, 400, { error: "invalid_json" });
		}
	});
});

io.on("connection", (socket) => {
	console.log("[ws] client connected", {
		socketId: socket.id,
		origin: socket.handshake.headers.origin ?? null,
	});

	socket.on(
		"auth:identify",
		(payload: { uid: string; familyIds: string[] }) => {
			const { uid, familyIds } = payload;
			if (WS_DEBUG) {
				console.log("[WS_DEBUG] auth identify", {
					socketId: socket.id,
					uid,
					familyIds,
				});
			}

			socket.data.uid = uid;

			for (const familyId of familyIds) {
				socket.join(`family:${familyId}`);
			}

			socket.join(`user:${uid}`);

			socket.emit("auth:ok");
		},
	);

	socket.on("disconnect", () => {
		console.log("[ws] client disconnected", { socketId: socket.id });
	});
});

httpServer.listen(PORT, () => {
	console.log(`[ws] listening on :${PORT}`);
	console.log("[ws] allowed origins", Array.from(allowedOrigins));
	console.log("[ws] allow all origins", allowAllOrigins);
});
