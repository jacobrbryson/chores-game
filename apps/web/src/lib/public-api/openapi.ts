export function buildPublicApiOpenApiSpec(origin = "http://localhost:3000") {
  const headers = {
    "X-Request-Id": {
      description: "Unique request identifier.",
      schema: { type: "string" },
    },
    "X-RateLimit-Limit": {
      description: "Daily request limit per API token.",
      schema: { type: "integer", example: 1000 },
    },
    "X-RateLimit-Remaining": {
      description: "Requests remaining today.",
      schema: { type: "integer", example: 999 },
    },
    "X-RateLimit-Reset": {
      description: "UTC timestamp when the daily quota resets.",
      schema: { type: "string", format: "date-time" },
    },
    "X-RateLimit-Used": {
      description: "Requests used today.",
      schema: { type: "integer", example: 1 },
    },
  };
  const errorSchema = {
    type: "object",
    properties: {
      error: {
        type: "object",
        properties: {
          code: { type: "string" },
          message: { type: "string" },
          requestId: { type: "string" },
        },
        required: ["code", "message", "requestId"],
      },
    },
    required: ["error"],
  };
  const errors = Object.fromEntries(
    [400, 401, 403, 404, 429, 500].map((status) => [
      status,
      {
        description:
          status === 429
            ? "Rate limit exceeded"
            : status === 401
              ? "Unauthorized"
              : status === 403
                ? "Forbidden"
                : status === 404
                  ? "Not found"
                  : status === 400
                    ? "Bad request"
                    : "Internal server error",
        headers,
        content: { "application/json": { schema: errorSchema } },
      },
    ]),
  );

  return {
    openapi: "3.1.0",
    info: {
      title: "Family Chores Public API",
      version: "1.0.0",
      description: "Read-only scoped API for assistant and automation integrations.",
    },
    servers: [{ url: origin }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "Family Chores API token",
        },
      },
      schemas: {
        Error: errorSchema,
      },
    },
    security: [{ bearerAuth: [] }],
    paths: {
      "/api/v1/me": {
        get: {
          summary: "Get API token owner context",
          description: "Required scope: read:profile",
          responses: {
            200: {
              description: "Current user and family context.",
              headers,
              content: {
                "application/json": {
                  example: {
                    userId: "user_123",
                    familyId: "family_123",
                    memberId: "user_123",
                    displayName: "Pip",
                    email: "pip@example.com",
                    role: "player",
                    familyName: "The Example Family",
                  },
                },
              },
            },
            ...errors,
          },
        },
      },
      "/api/v1/players": {
        get: {
          summary: "List visible players",
          description: "Required scope: read:players",
          responses: {
            200: {
              description: "Players visible to this token owner.",
              headers,
              content: {
                "application/json": {
                  example: {
                    players: [
                      { playerId: "123", uid: "123", displayName: "Pip", status: "active" },
                    ],
                  },
                },
              },
            },
            ...errors,
          },
        },
      },
      "/api/v1/players/{playerId}/coins": {
        get: {
          summary: "Get a player's coin balance",
          description: "Required scope: read:coins",
          parameters: [{ name: "playerId", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            200: {
              description: "Coin balance summary.",
              headers,
              content: {
                "application/json": {
                  example: {
                    playerId: "123",
                    displayName: "Pip",
                    coinBalance: 142,
                    pendingCoins: 35,
                    approvedCoins: 142,
                    updatedAt: "2026-05-23T12:00:00.000Z",
                  },
                },
              },
            },
            ...errors,
          },
        },
      },
      "/api/v1/players/{playerId}/chores/today": {
        get: {
          summary: "Get today's chores for a player",
          description: "Required scope: read:chores",
          parameters: [{ name: "playerId", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            200: {
              description: "Visible chores due today or with no due date.",
              headers,
              content: {
                "application/json": {
                  example: {
                    playerId: "123",
                    chores: [{ id: "chore_1", title: "Feed the dog", status: "Open", coinValue: 5 }],
                  },
                },
              },
            },
            ...errors,
          },
        },
      },
      "/api/v1/players/{playerId}/achievements/recent": {
        get: {
          summary: "Get recently unlocked achievements",
          description: "Required scope: read:achievements",
          parameters: [{ name: "playerId", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            200: {
              description: "Recent completed achievements.",
              headers,
              content: {
                "application/json": {
                  example: {
                    playerId: "123",
                    achievements: [
                      {
                        achievementId: "player_first_chore",
                        title: "First Chore",
                        completedAt: "2026-05-23T12:00:00.000Z",
                      },
                    ],
                  },
                },
              },
            },
            ...errors,
          },
        },
      },
    },
  };
}
