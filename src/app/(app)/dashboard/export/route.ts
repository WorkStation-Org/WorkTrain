import { currentActor } from "@/lib/auth";
import { formatSpeed } from "@/domain/stats";
import { dashboard, learningRecord, PROGRESS_LABEL, toCsv } from "@/lib/stats-service";
import { bangkokDate, bangkokMonth, formatBangkok } from "@/lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Export ของ Dashboard (spec §12) — CSV แบบ UTF-8 + BOM ที่ Excel เปิดได้ตรง ๆ · สิทธิ์เดียวกับหน้า Dashboard
 * `?kind=people` สถิติรายคน · `?kind=status` สถานะรายชุด (เดือน) · `?kind=record` ใครเรียนอะไรไปแล้ว (ทั้งหมดตั้งแต่เริ่ม ไม่ดู `month`) · ตัวกรองเดียวกับหน้า
 * ★ คอลัมน์ใหม่ต่อท้ายเสมอ (ชื่อเล่น · ทีม · อยู่ในผัง · ตัดจบเมื่อ) — สูตร Excel ที่อ้างคอลัมน์เดิมไม่พัง
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
  const yesNo = (v: boolean | null) => (v === null ? null : v ? "ใช่" : "ไม่");
  const when = (d: Date | null) => (d ? formatBangkok(d) : null);

  if (q.get("kind") === "record") {
    // CSV ส่งทุกคน รวมคนที่หน้าจอซ่อน — เหมือน kind อื่น
    const { rows } = await learningRecord(actor, { teamId: num("team"), managerPersonId: num("manager"), setId: num("set"), showHidden: true });
    const csv = toCsv(
      ["ชื่อ", "ชื่อเล่น", "ทีม", "ชุด", "ได้รับมอบ", "กำหนดส่ง", "ผ่านเมื่อ", "สถานะ", "ครั้งที่สอบ", "อยู่ในผัง", "ตัดจบเมื่อ"],
      rows.map((r) => [r.personName, r.label.nickname, r.teamName, r.setTitle, when(r.assignedAt), when(r.dueAt), when(r.passedAt), PROGRESS_LABEL[r.progress], r.attempts, yesNo(r.inOrg), when(r.endedAt)]),
    );
    return csvResponse(csv, `worktrain-record-${bangkokDate()}.csv`);
  }

  // CSV ส่งทุกคน รวมคนที่หน้าจอซ่อน (ลาออก · ตัดจบ) — มีคอลัมน์ "อยู่ในผัง" ให้กรองเองใน Excel
  const data = await dashboard(actor, { month, teamId: num("team"), managerPersonId: num("manager"), setId: num("set"), showHidden: true });
  if (!data) return Response.json({ error: "bad_month" }, { status: 400 });

  const kind = q.get("kind") === "status" ? "status" : "people";
  const csv =
    kind === "people"
      ? toCsv(
          ["ชื่อ", "ได้รับมอบ", "ผ่าน", "คะแนนครั้งแรก", "คะแนนเฉลี่ย", "ครั้งที่สอบ", "ความไว (ชม.)", "ความไว", "ออกจากหน้าสอบ", "ชื่อเล่น", "ทีม", "อยู่ในผัง"],
          data.people.map((p) => [p.personName, p.assigned, p.passed, p.firstScore, p.avgScore, p.attempts, p.speedHours, formatSpeed(p.speedHours), p.leaves, p.label.nickname, p.label.team, yesNo(p.inOrg)]),
        )
      : toCsv(
          ["ชุด", "ชื่อ", "ทีม", "ได้รับมอบ", "กำหนดส่ง", "ผ่านเมื่อ", "สถานะ", "ครั้งที่สอบ", "ชื่อเล่น", "อยู่ในผัง", "ตัดจบเมื่อ"],
          data.rows.map((r) => [
            r.setTitle,
            r.personName,
            r.teamName,
            formatBangkok(r.assignedAt),
            formatBangkok(r.dueAt),
            r.passedAt ? formatBangkok(r.passedAt) : null,
            PROGRESS_LABEL[r.progress],
            r.attempts,
            r.label.nickname,
            yesNo(r.inOrg),
            r.endedAt ? formatBangkok(r.endedAt) : null,
          ]),
        );
  return csvResponse(csv, `worktrain-${kind}-${month}.csv`);
}

function csvResponse(csv: string, filename: string) {
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
