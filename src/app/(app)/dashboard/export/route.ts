import { currentActor } from "@/lib/auth";
import { formatSpeed } from "@/domain/stats";
import { dashboard, PROGRESS_LABEL, toCsv } from "@/lib/stats-service";
import { bangkokMonth, formatBangkok } from "@/lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Export ของ Dashboard (spec §12) — CSV แบบ UTF-8 + BOM ที่ Excel เปิดได้ตรง ๆ · สิทธิ์เดียวกับหน้า Dashboard
 * `?kind=people` สถิติรายคน · `?kind=status` สถานะรายชุด · ตัวกรองเดียวกับหน้า
 */
export async function GET(req: Request) {
  const actor = await currentActor();
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });
  const q = new URL(req.url).searchParams;
  const num = (k: string) => {
    const n = Number(q.get(k));
    return Number.isInteger(n) && n > 0 ? n : undefined;
  };
  const month = q.get("month") ?? bangkokMonth();
  const data = await dashboard(actor, { month, teamId: num("team"), managerPersonId: num("manager"), setId: num("set") });
  if (!data) return Response.json({ error: "bad_month" }, { status: 400 });

  const kind = q.get("kind") === "status" ? "status" : "people";
  const csv =
    kind === "people"
      ? toCsv(
          ["ชื่อ", "ได้รับมอบ", "ผ่าน", "คะแนนครั้งแรก", "คะแนนเฉลี่ย", "ครั้งที่สอบ", "ความไว (ชม.)", "ความไว", "ออกจากหน้าสอบ"],
          data.people.map((p) => [p.personName, p.assigned, p.passed, p.firstScore, p.avgScore, p.attempts, p.speedHours, formatSpeed(p.speedHours), p.leaves]),
        )
      : toCsv(
          ["ชุด", "ชื่อ", "ทีม", "ได้รับมอบ", "กำหนดส่ง", "ผ่านเมื่อ", "สถานะ", "ครั้งที่สอบ"],
          data.rows.map((r) => [r.setTitle, r.personName, r.teamName, formatBangkok(r.assignedAt), formatBangkok(r.dueAt), r.passedAt ? formatBangkok(r.passedAt) : null, PROGRESS_LABEL[r.progress], r.attempts]),
        );
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="worktrain-${kind}-${month}.csv"`,
      "cache-control": "no-store",
    },
  });
}
