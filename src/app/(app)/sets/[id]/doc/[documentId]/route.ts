import { currentActor } from "@/lib/auth";
import { previewPricelistPdf } from "@/lib/set-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /sets/{setId}/doc/{documentId} — Pricelist ที่ประทับลายน้ำของคนเปิด ให้ผู้สร้าง · ผู้อนุมัติ · TG ตรวจในแท็บเอกสาร
 * ทางเดียวกับฝั่งผู้เรียน (`/learn/.../doc/...`): ไม่ส่งไฟล์ต้นฉบับ · ไม่ให้ cache · ไม่มีชื่อไฟล์ให้บันทึก (spec §13 · ADR-0010)
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string; documentId: string }> }) {
  const actor = await currentActor();
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });
  const p = await ctx.params;
  const out = await previewPricelistPdf({ actor, setId: Number(p.id), documentId: Number(p.documentId) });
  if (!out.ok) return Response.json({ error: out.error }, { status: 404 });
  return new Response(Buffer.from(out.bytes), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": "inline",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
