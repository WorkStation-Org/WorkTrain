import { requireConsumer } from "@/lib/api-consumers";
import { trainingStatus } from "@/lib/onboarding-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/people/{email}/training-status — WorkHR ดึงสถานะเส้นทาง Onboarding (spec §6)
 *
 * 200 → `{ email, personId, positionId, sets: [{ setId, title, assignedAt, dueAt, passed, passedAt }], complete }`
 * 404 `not_found` = ยังไม่มีตัวตนใน WorkID · 503 `org_unavailable` = ถามผังไม่ได้ ลองใหม่ (ไม่ใช่ "ยังไม่ผ่าน")
 */
export async function GET(req: Request, ctx: { params: Promise<{ email: string }> }) {
  const g = requireConsumer(req, "read");
  if (!g.ok) return g.res;
  const { email } = await ctx.params;
  const out = await trainingStatus(decodeURIComponent(email));
  if (!out.ok) {
    console.log(JSON.stringify({ msg: "training_status_miss", consumer: g.consumer.name, why: out.why }));
    return Response.json({ error: out.why }, { status: out.why === "not_found" ? 404 : 503 });
  }
  return Response.json(out.status);
}
