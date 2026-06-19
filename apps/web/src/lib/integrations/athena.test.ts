import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AthenaIntegrationError,
  connectAthena,
  getAthenaConfig,
  isAthenaConfigured,
} from "@/lib/integrations/athena";

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const ENV = {
  ATHENA_PROXY_BASE_URL: "https://athena.example.com/",
  ATHENA_PARTNER_KEY: "partner-secret",
  FAMILY_CHORES_PUBLIC_API_BASE_URL: "https://api.familychores.app",
};

describe("athena client", () => {
  beforeEach(() => {
    vi.stubEnv("ATHENA_PROXY_BASE_URL", ENV.ATHENA_PROXY_BASE_URL);
    vi.stubEnv("ATHENA_PARTNER_KEY", ENV.ATHENA_PARTNER_KEY);
    vi.stubEnv("FAMILY_CHORES_PUBLIC_API_BASE_URL", ENV.FAMILY_CHORES_PUBLIC_API_BASE_URL);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("reads + normalises config (trailing slash stripped)", () => {
    const config = getAthenaConfig();
    expect(config.proxyBaseUrl).toBe("https://athena.example.com");
    expect(config.partnerKey).toBe("partner-secret");
    expect(config.apiBaseUrl).toBe("https://api.familychores.app");
    expect(isAthenaConfigured()).toBe(true);
  });

  it("throws config_error when the partner key is missing", () => {
    vi.stubEnv("ATHENA_PARTNER_KEY", "");
    expect(isAthenaConfigured()).toBe(false);
    try {
      getAthenaConfig();
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AthenaIntegrationError);
      expect((error as AthenaIntegrationError).code).toBe("config_error");
    }
  });

  it("sends X-Partner-Key + body and returns data on 201", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(201, {
        success: true,
        connected: true,
        created_account: true,
        email: "parent@example.com",
        display_name: "Pip",
        player_id: "player-1",
        family_name: "The Smiths",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await connectAthena({ apiToken: "fc_live_abc", baseUrl: "https://api.familychores.app" });

    expect(result.connected).toBe(true);
    expect(result.created_account).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://athena.example.com/api/v1/integrations/family-chores/connect");
    expect((init.headers as Record<string, string>)["X-Partner-Key"]).toBe("partner-secret");
    expect(JSON.parse(init.body as string)).toEqual({
      apiToken: "fc_live_abc",
      baseUrl: "https://api.familychores.app",
    });
  });

  it.each([
    [400, "invalid_request", 400],
    [401, "config_error", 502],
    [403, "forbidden", 403],
    [502, "upstream_error", 502],
    [500, "upstream_error", 502],
    [418, "unknown_error", 502],
  ])("maps HTTP %i to %s", async (httpStatus, code, clientStatus) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(httpStatus, { error: "x" })));

    try {
      await connectAthena({ apiToken: "fc_live_abc", baseUrl: "https://api.familychores.app" });
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AthenaIntegrationError);
      expect((error as AthenaIntegrationError).code).toBe(code);
      expect((error as AthenaIntegrationError).status).toBe(clientStatus);
    }
  });

  it("maps a network failure to upstream_error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    try {
      await connectAthena({ apiToken: "fc_live_abc", baseUrl: "https://api.familychores.app" });
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AthenaIntegrationError);
      expect((error as AthenaIntegrationError).code).toBe("upstream_error");
    }
  });
});
