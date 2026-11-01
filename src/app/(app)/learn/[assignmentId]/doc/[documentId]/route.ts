import { currentActor } from "@/lib/auth";
import { hasConsent } from "@/lib/identity-service";
import { pricelistPdf } from "@/lib/learn-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /learn/{assignmentId}/doc/{documentId} — Pricelist ที่ประทับลายน้ำของคนเปิดแล้ว (spec §13 · ADR-0010)
 * ตัวอ่าน (pdfjs) โหลดจากที่นี่แทนลิงก์ R2 · ไม่ส่งไฟล์ต้นฉบับ · ไม่ให้ cache · ไม่มีชื่อไฟล์ให้บันทึก
 */
export async function GET(_req: Request, ctx: { params: Promise<{ assignmentId: string; documentId: string }> }) {
  const actor = await currentActor();
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!(await hasConsent(actor.personId))) return Response.json({ error: "consent_required" }, { status: 403 });
  const p = await ctx.params;
  const out = await pricelistPdf({ personId: actor.personId, email: actor.email, assignmentId: Number(p.assignmentId), documentId: Number(p.documentId) });
  if (!out.ok) return Response.json({ error: out.error }, { status: out.error === "session_ended" ? 409 : 404 });
  return new Response(Buffer.from(out.bytes), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": "inline",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
