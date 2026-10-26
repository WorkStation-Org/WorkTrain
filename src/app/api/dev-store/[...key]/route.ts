import { isDocumentMime } from "@/domain/document";
import { devShortcutAllowed } from "@/lib/dev";
import { devStoreObjects, r2Configured } from "@/lib/object-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ที่เก็บไฟล์จำลองบนเครื่อง dev — แทน R2 ตอนยังไม่ได้ตั้ง bucket (`localDevStore()` ใน object-store · ยกจาก WorkDecision)
 * ★ ตายเพราะที่ที่รันแบบเดียวกับทางลัด dev อื่น: บน Vercel / production หรือเมื่อตั้ง R2 แล้ว ตอบ 404 เสมอ
 */
async function keyOf(params: Promise<{ key: string[] }>): Promise<string | null> {
  if (!devShortcutAllowed() || r2Configured()) return null;
  return (await params).key.join("/");
}

export async function PUT(req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const key = await keyOf(params);
  if (!key) return new Response(null, { status: 404 });
  devStoreObjects().set(key, new Uint8Array(await req.arrayBuffer()));
  return new Response(null, { status: 200 });
}

export async function GET(req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const key = await keyOf(params);
  const body = key ? devStoreObjects().get(key) : undefined;
  if (!body) return new Response(null, { status: 404 });
  const ct = new URL(req.url).searchParams.get("ct");
  return new Response(Buffer.from(body), {
    headers: { "content-type": isDocumentMime(ct) ? ct : "application/octet-stream", "x-content-type-options": "nosniff" },
  });
}
