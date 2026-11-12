import { currentActor } from "@/lib/auth";
import { coverImage } from "@/lib/set-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/covers/{documentId} — ภาพปกวิดีโอ (ADR-0013)
 * ผ่านเซิร์ฟเวอร์ของเราเพื่อตรวจสิทธิ์ (คนทำงานกับชุด หรือผู้เรียนที่ได้รับมอบ) และไม่ต้องส่งลิงก์ R2 ออกไป
 * ภาพเล็ก (≤ 512 KB) · cache ได้ในเบราว์เซอร์ของคนนั้น — ที่อยู่มี `?v=` เปลี่ยนเมื่อเปลี่ยนปก
 */
export async function GET(_req: Request, ctx: { params: Promise<{ documentId: string }> }) {
  const actor = await currentActor();
  if (!actor) return new Response(null, { status: 401 });
  const id = Number.parseInt((await ctx.params).documentId, 10);
  const bytes = Number.isInteger(id) ? await coverImage({ actor, documentId: id }) : null;
  if (!bytes) return new Response(null, { status: 404 });
  return new Response(Buffer.from(bytes), {
    headers: {
      "content-type": "image/jpeg",
      "cache-control": "private, max-age=86400",
      "x-content-type-options": "nosniff",
    },
  });
}
