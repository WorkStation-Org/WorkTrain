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
  const headers = {
    "content-type": isDocumentMime(ct) ? ct : "application/octet-stream",
    "x-content-type-options": "nosniff",
    "accept-ranges": "bytes",
  };
  // ตัวเล่นวิดีโอขอไฟล์เป็นช่วง (กรอ · บัฟเฟอร์) แบบเดียวกับ R2 — ADR-0013
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (range && (range[1] || range[2])) {
    const size = body.byteLength;
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    return new Response(Buffer.from(body.subarray(start, end + 1)), {
      status: 206,
      headers: { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) },
    });
  }
  return new Response(Buffer.from(body), { headers });
}
