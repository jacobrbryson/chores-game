export function buildHealthPayload() {
  return {
    status: "ok",
    service: "family-chores-api",
    version: "v1",
    timestamp: new Date().toISOString(),
  };
}
