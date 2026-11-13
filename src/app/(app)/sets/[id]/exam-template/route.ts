import { currentActor } from "@/lib/auth";
import { examTemplate } from "@/lib/exam-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /sets/{id}/exam-template — Template ข้อสอบ .xlsx ของชุดนี้ (ADR-0015) · `?kind=delta` = ข้อสอบส่วนที่เปลี่ยน
 * สิทธิ์เดียวกับปุ่ม Import (`examTemplate`) · มีเฉลยของข้อสอบเดิม — ไม่ให้ cache
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await currentActor();
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });
  const setId = Number.parseInt((await ctx.params).id, 10);
  const kind = new URL(req.url).searchParams.get("kind") === "delta" ? "delta" : "full";
  const out = Number.isInteger(setId) ? await examTemplate({ actor, setId, kind }) : { ok: false as const, error: "ไม่พบชุดนี้" };
  if (!out.ok) return Response.json({ error: out.error }, { status: 403 });
  return new Response(Buffer.from(out.bytes), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      // ชื่อไทยต้องผ่าน filename* · filename ธรรมดาไว้ให้เบราว์เซอร์เก่า
      "content-disposition": `attachment; filename="exam-template-${setId}.xlsx"; filename*=UTF-8''${encodeURIComponent(out.fileName)}`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
