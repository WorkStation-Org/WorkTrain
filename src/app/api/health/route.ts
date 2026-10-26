import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { errorSummary } from "@/lib/errmsg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/health — **ต้องแตะ dependency จริง** (กติกาเครือข้อ 6)
 *
 * endpoint ที่ตอบ 200 เฉย ๆ ไม่ใช่ health check — มันบอกแค่ว่า "โค้ดถูก deploy อยู่"
 * ซึ่งเป็นสิ่งที่แทบไม่เคยเป็นสาเหตุ ของที่ล่มจริงคือ Neon / WorkID / GateWay
 *
 * ตัวนี้ตอบเฉพาะ dependency ที่ **ล่มแล้ว WorkTrain ใช้ไม่ได้เลย** คือฐานข้อมูล
 * ส่วน WorkID/GateWay ไม่เอามาไว้ที่นี่ เพราะ WorkTrain (เหมือน WorkIT) ออกแบบให้ทำงานต่อได้เมื่อ
 * WorkID ล่ม (fail-open) — เอามาใส่จะทำให้ health แดงทั้งที่ระบบยังใช้งานได้
 *
 * ★ ข้อ 23: รายงานต้องบอก "เพราะอะไร" ไม่ใช่แค่ "อะไรล้ม" — ใช้ errorSummary ไล่ err.cause
 */
export async function GET() {
  const startedAt = Date.now();
  try {
    await db().execute(sql`select 1`);
    // `ok` ต้องมี — ตัวเฝ้า uptime ของ GateWay นับว่าผ่านเมื่อ 2xx และ body เป็น JSON ที่มี `ok`
    return NextResponse.json({
      ok: true,
      status: "ok",
      db: "ok",
      latencyMs: Date.now() - startedAt,
    });
  } catch (err) {
    console.log(JSON.stringify({ msg: "health_db_failed", error: errorSummary(err) }));
    return NextResponse.json(
      {
        ok: false,
        status: "fail",
        db: "fail",
        reason: errorSummary(err),
        latencyMs: Date.now() - startedAt,
      },
      { status: 503 },
    );
  }
}
