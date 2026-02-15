import { createServer } from "node:http";
import { Server } from "socket.io";

const PORT = Number(process.env.PORT ?? 3001);
const ORIGIN = process.env.WS_ORIGIN;

if (!ORIGIN) {
	throw new Error("WS_ORIGIN env var is required for websocket CORS.");
}

const httpServer = createServer();

const io = new Server(httpServer, {
	cors: { origin: ORIGIN, methods: ["GET", "POST"], credentials: true },
	transports: ["websocket"],
});

io.on("connection", (socket) => {
	console.log("client connected");

	socket.on(
		"auth:identify",
		(payload: { uid: string; familyIds: string[] }) => {
			const { uid, familyIds } = payload;

			socket.data.uid = uid;

			for (const familyId of familyIds) {
				socket.join(`family:${familyId}`);
			}

			socket.join(`user:${uid}`);

			socket.emit("auth:ok");
		},
	);

	socket.on("disconnect", () => {
		console.log("client disconnected");
	});
});

httpServer.listen(PORT, () => {
	console.log(`[ws] listening on :${PORT}`);
});
