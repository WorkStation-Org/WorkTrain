import Link from "next/link";
import { Badge, buttonClass, Card, EmptyState, FIELD_LABEL_CLASS, INPUT_CLASS, PageHeader, SectionTitle, SELECT_CLASS, Table, TBody, TD, TH, THead, TR, type BadgeTone } from "@/components/ui";
import { formatSpeed } from "@/domain/stats";
import { firstParam, pageActor } from "@/lib/page";
import { dashboard, monthLeaderboard, PROGRESS_LABEL, type SetProgress } from "@/lib/stats-service";
import { bangkokMonth, formatBangkok, formatMonth } from "@/lib/time";

export const dynamic = "force-dynamic";

const TONE: Record<SetProgress, BadgeTone> = { not_opened: "neutral", opened: "info", tried: "warning", passed: "success" };

/**
 * Dashboard + Leaderboard (spec §12)
 * TG เห็นทุกคน · หัวหน้าเห็นทีมที่ดูแล · ผู้สร้างเห็นชุดของตัวเอง · ทุกคนเห็นของตัวเอง + Leaderboard
 */
export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await pageActor();
  const sp = await searchParams;
  const num = (k: string) => {
    const n = Number(firstParam(sp[k]));
    return Number.isInteger(n) && n > 0 ? n : undefined;
  };
  const month = firstParam(sp.month) ?? bangkokMonth();
  const filter = { month, teamId: num("team"), managerPersonId: num("manager"), setId: num("set") };
  const data = await dashboard(actor, filter);
  const board = await monthLeaderboard(month);
  if (!data || !board) {
    return (
      <main className="mx-auto max-w-md px-4 py-8">
        <p className="text-[13px] text-danger">เดือนไม่ถูกต้อง — ใช้รูปแบบ ปปปป-ดด</p>
        <Link href="/dashboard" className="text-[13px] underline">
          เดือนนี้
        </Link>
      </main>
    );
  }
  const qs = new URLSearchParams(Object.entries({ month, team: filter.teamId, manager: filter.managerPersonId, set: filter.setId }).flatMap(([k, v]) => (v ? [[k, String(v)]] : [])));

  return (
    <main className="mx-auto max-w-6xl space-y-5 px-4 py-8">
      <PageHeader
        title="Dashboard"
        subtitle={`${formatMonth(month)} · ${data.scope === "all" ? "ทุกคน" : "ของคุณ ทีมที่คุณดูแล และชุดที่คุณสร้าง"}`}
        actions={<Link href="/" className="text-[13px] text-ink-3 underline">หน้าแรก</Link>}
      />

      <Card>
        <form className="grid gap-3 sm:grid-cols-5 sm:items-end">
          <label>
            <span className={FIELD_LABEL_CLASS}>เดือน</span>
            <input type="month" name="month" defaultValue={month} className={INPUT_CLASS} />
          </label>
          <label>
            <span className={FIELD_LABEL_CLASS}>ทีม</span>
            <select name="team" defaultValue={filter.teamId ?? ""} className={SELECT_CLASS}>
              <option value="">ทั้งหมด</option>
              {data.teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className={FIELD_LABEL_CLASS}>หัวหน้า</span>
            <select name="manager" defaultValue={filter.managerPersonId ?? ""} className={SELECT_CLASS}>
              <option value="">ทั้งหมด</option>
              {data.managers.map((m) => (
                <option key={m.personId} value={m.personId}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className={FIELD_LABEL_CLASS}>ชุด</span>
            <select name="set" defaultValue={filter.setId ?? ""} className={SELECT_CLASS}>
              <option value="">ทั้งหมด</option>
              {data.sets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={buttonClass("secondary")}>
            กรอง
          </button>
        </form>
        {!data.orgOk && <p className="mt-3 text-[12px] text-danger">ดึงผังจาก WorkID ไม่ได้ — ตัวกรองทีม/หัวหน้าและสิทธิ์หัวหน้าใช้ไม่ได้ชั่วคราว</p>}
      </Card>

      <Card>
        <SectionTitle className="mb-3">Leaderboard Top 10 · {formatMonth(month)}</SectionTitle>
        <p className="mb-3 text-[12px] text-ink-3">คะแนนครั้งแรกเฉลี่ย · เท่ากันใช้ความไว · ไม่นับชุดที่ตัวเองสร้างหรืออนุมัติ · TG ไม่ติดอันดับ</p>
        {!board.tgExcluded && board.rows.length > 0 && <p className="mb-3 text-[12px] text-danger">ถามรายชื่อ TG จาก WorkID ไม่ได้ — อันดับนี้อาจมี TG ปนอยู่</p>}
        {board.rows.length === 0 ? (
          <EmptyState compact title="ยังไม่มีใครสอบในเดือนนี้" />
        ) : (
          <ol className="divide-y divide-line">
            {board.rows.map((r) => (
              <li key={r.personId} className={`flex items-center gap-3 py-2 text-[13px] ${r.personId === actor.personId ? "font-semibold" : ""}`}>
                <span className="w-6 text-right text-ink-3">{r.rank}</span>
                <span className="flex-1">{r.personName}</span>
                <span className="w-16 text-right">{r.firstScore}%</span>
                <span className="w-28 text-right text-ink-3">{formatSpeed(r.speedHours)}</span>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Card>
        <SectionTitle className="mb-3" right={<a href={`/dashboard/export?kind=people&${qs}`} className={buttonClass("ghost", "sm")}>Export Excel</a>}>
          สถิติรายคน
        </SectionTitle>
        {data.people.length === 0 ? (
          <EmptyState compact title="ไม่มีข้อมูลในเดือนนี้" />
        ) : (
          <Table minWidth="min-w-[760px]">
            <THead>
              <tr>
                <TH>ชื่อ</TH>
                <TH align="right">ได้รับมอบ</TH>
                <TH align="right">ผ่าน</TH>
                <TH align="right">คะแนนครั้งแรก</TH>
                <TH align="right">คะแนนเฉลี่ย</TH>
                <TH align="right">ครั้งที่สอบ</TH>
                <TH align="right">ความไว</TH>
                <TH align="right">ออกจากหน้าสอบ</TH>
              </tr>
            </THead>
            <TBody>
              {data.people.map((p) => (
                <TR key={p.personId}>
                  <TD>{p.personName}</TD>
                  <TD align="right">{p.assigned}</TD>
                  <TD align="right">{p.passed}</TD>
                  <TD align="right">{p.firstScore ?? "—"}</TD>
                  <TD align="right">{p.avgScore ?? "—"}</TD>
                  <TD align="right">{p.attempts}</TD>
                  <TD align="right">{formatSpeed(p.speedHours)}</TD>
                  <TD align="right">{p.leaves}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <Card>
        <SectionTitle className="mb-3" right={<a href={`/dashboard/export?kind=status&${qs}`} className={buttonClass("ghost", "sm")}>Export Excel</a>}>
          สถานะรายชุด
        </SectionTitle>
        {data.rows.length === 0 ? (
          <EmptyState compact title="ไม่มีการมอบในเดือนนี้" />
        ) : (
          <Table minWidth="min-w-[820px]">
            <THead>
              <tr>
                <TH>ชุด</TH>
                <TH>ชื่อ</TH>
                <TH>ทีม</TH>
                <TH>ได้รับมอบ</TH>
                <TH>กำหนดส่ง</TH>
                <TH>สถานะ</TH>
                <TH align="right">ครั้งที่สอบ</TH>
              </tr>
            </THead>
            <TBody>
              {data.rows.map((r) => (
                <TR key={r.assignmentId}>
                  <TD>{r.setTitle}</TD>
                  <TD>{r.personName}</TD>
                  <TD>{r.teamName ?? "—"}</TD>
                  <TD>{formatBangkok(r.assignedAt)}</TD>
                  <TD>{formatBangkok(r.dueAt)}</TD>
                  <TD>
                    <Badge tone={TONE[r.progress]} label={PROGRESS_LABEL[r.progress]} />
                  </TD>
                  <TD align="right">{r.attempts}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </main>
  );
}
