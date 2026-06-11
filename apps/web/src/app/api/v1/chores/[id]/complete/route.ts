import { NextRequest } from "next/server";
import { fail, ok, proxyJson } from "@/app/api/v1/_lib/response";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await request.json().catch(() => ({})) as { approvalPayouts?: unknown };
  const upstream = await proxyJson(request, `/api/chores/${id}`, {
    method: "PATCH",
    body: JSON.stringify({
      action: "complete",
      approvalPayouts: body.approvalPayouts,
    }),
  });
  if (upstream.status >= 400) {
    return fail(String(upstream.json?.error ?? "upstream_error"), "Failed to complete chore", upstream.status, upstream.json);
  }
  // Forward New Skill Bonus metadata so mobile can celebrate the first-time bonus.
  const newSkillBonus = (upstream.json as { newSkillBonus?: unknown } | undefined)?.newSkillBonus;
  return ok({ id, status: "Submitted", ...(newSkillBonus ? { newSkillBonus } : {}) });
}
