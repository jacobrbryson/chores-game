import { ok } from "@/app/api/v1/_lib/response";
import { buildHealthPayload } from "@/app/api/v1/health/health-payload";

export async function GET() {
  return ok(buildHealthPayload());
}
