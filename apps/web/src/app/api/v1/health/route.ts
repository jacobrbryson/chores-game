import { ok } from "@/app/api/v1/_lib/response";

export function buildHealthPayload() {
  return {
    status: "ok",
    service: "family-chores-api",
    version: "v1",
    timestamp: new Date().toISOString(),
  };
}

export async function GET() {
  return ok(buildHealthPayload());
}
