import Link from "next/link";
import { buttonClass, Card, EmptyState, FIELD_LABEL_CLASS, INPUT_CLASS, PageHeader, SectionTitle, SELECT_CLASS } from "@/components/ui";
import { firstParam, pageActor } from "@/lib/page";
import { dashboard, monthLeaderboard } from "@/lib/stats-service";
import { bangkokMonth, formatMonth } from "@/lib/time";
import { countProgress, groupBySet, LeaderboardList, PeopleTable, SetGroups, StatusSummary } from "./parts";

export const dynamic = "force-dynamic";

/**
 * Dashboard + Leaderboard (spec §12)
 * TG เห็นทุกคน · หัวหน้าเห็นทีมที่ดูแล · ผู้สร้างเห็นชุดของตัวเอง · ทุกคนเห็นของตัวเอง + Leaderboard
 *
 * โครงตามความกว้างของกรอบหน้า (`@container` — เมนูซ้ายยุบ/ขยายเปลี่ยนพื้นที่ได้):
 *   ≥ 64rem   ตาราง (ซ้าย) + แถบขวา: สรุปสถานะ · Leaderboard
 *   ≥ 42rem   สรุปสถานะ | Leaderboard คู่กันหนึ่งแถว แล้วตารางเต็มกว้าง (แท็บเล็ตแนวนอน)
 *   แคบกว่านั้น เรียงลงทีละส่วน · ตารางเลื่อนแนวนอนได้ คอลัมน์ชื่อตรึงซ้าย
 */
export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await pageActor();
  const sp = await searchParams;
  const num = (k: string) => {
    const n = Number(firstParam(sp[k]));
    return Number.isInteger(n) && n > 0 ? n : undefined;
  };
  const month = firstParam(sp.month) ?? bangkokMonth();
  const showHidden = firstParam(sp.hidden) === "1";
  const expandAll = firstParam(sp.open) === "1";
  const filter = { month, teamId: num("team"), managerPersonId: num("manager"), setId: num("set"), showHidden };
  const data = await dashboard(actor, filter);
  const board = await monthLeaderboard(month, { showHidden });
  if (!data || !board) {
    return (
      <main className="mx-auto w-full max-w-md">
        <p className="text-[13px] text-danger">เดือนไม่ถูกต้อง — ใช้รูปแบบ ปปปป-ดด</p>
        <Link href="/dashboard" className="text-[13px] underline">
          เดือนนี้
        </Link>
      </main>
    );
  }
  const now = new Date();
  const counts = countProgress(data.rows, now);
  const groups = groupBySet(data.rows, now);
  // ชุดเดียว (หรือกรองชุดไว้) ไม่ต้องให้กดเปิดอีกชั้น
  const openGroups = expandAll || groups.length === 1;

  const params = { month, team: filter.teamId, manager: filter.managerPersonId, set: filter.setId };
  const qs = new URLSearchParams(Object.entries(params).flatMap(([k, v]) => (v ? [[k, String(v)]] : [])));
  /** ลิงก์กลับหน้านี้ด้วยตัวกรองเดิม แต่สลับ `hidden` / `open` */
  const href = (o: { hidden: boolean; open: boolean }) => {
    const q = new URLSearchParams(qs);
    if (o.hidden) q.set("hidden", "1");
    if (o.open) q.set("open", "1");
    return `/dashboard?${q}`;
  };
  /** บรรทัด "ซ่อน n คน · แสดง" ใต้แต่ละส่วน — ปุ่มเดียวสลับทั้งหน้า · `edge` = การ์ดที่ตารางชิดขอบ */
  const hiddenLine = (n: number, unit = "คน", edge = false) =>
    n > 0 || showHidden ? (
      <p className={`border-t border-line text-[12px] text-ink-3 ${edge ? "px-5 py-3" : "mt-3 pt-3"}`}>
        {showHidden ? "แสดงคนที่ไม่อยู่ในผังหรือถูกตัดจบด้วย" : `ซ่อน ${n} ${unit}ที่ไม่อยู่ในผังหรือถูกตัดจบ`} ·{" "}
        <Link href={href({ hidden: !showHidden, open: expandAll })} className="underline">
          {showHidden ? "ซ่อน" : "แสดง"}
        </Link>
      </p>
    ) : null;

  return (
    <main className="@container mx-auto w-full max-w-[1680px]">
      <PageHeader
        kicker="Insights"
        title="Dashboard"
        subtitle={`${formatMonth(month)} · ${data.scope === "all" ? "ทุกคน" : "ของคุณ ทีมที่คุณดูแล และชุดที่คุณสร้าง"}`}
      />

      <Card padded={false} className="p-4">
        <form className="grid gap-3 @sm:grid-cols-2 @4xl:grid-cols-[10.5rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.6fr)_auto] @4xl:items-end">
          {showHidden && <input type="hidden" name="hidden" value="1" />}
          {expandAll && <input type="hidden" name="open" value="1" />}
          <label className="min-w-0">
            <span className={FIELD_LABEL_CLASS}>เดือน</span>
            <input type="month" name="month" defaultValue={month} className={INPUT_CLASS} />
          </label>
          <label className="min-w-0">
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
          <label className="min-w-0">
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
          <label className="min-w-0">
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
          <button type="submit" className={buttonClass("secondary", "md", "h-[42px] @sm:col-span-2 @4xl:col-span-1 @4xl:px-6")}>
            กรอง
          </button>
        </form>
        {!data.orgOk && <p className="mt-3 text-[12px] text-danger">ดึงผังจาก WorkID ไม่ได้ — ตัวกรองทีม/หัวหน้าและสิทธิ์หัวหน้าใช้ไม่ได้ชั่วคราว</p>}
      </Card>

      <div className="mt-5 grid items-start gap-5 @5xl:grid-cols-[minmax(0,1fr)_21rem] @7xl:grid-cols-[minmax(0,1fr)_23rem]">
        {/* ภาพรวมมาก่อนใน DOM — จอแคบอ่านสรุปก่อนตาราง · จอกว้างย้ายไปเป็นแถบขวา */}
        <aside className="grid items-start gap-5 @2xl:grid-cols-2 @5xl:col-start-2 @5xl:row-start-1 @5xl:grid-cols-1" aria-label="ภาพรวม">
          <Card>
            <StatusSummary counts={counts} />
          </Card>

          <Card>
            <SectionTitle>Leaderboard Top 10</SectionTitle>
            <p className="mt-1.5 mb-3 text-[12px] leading-relaxed text-ink-3">คะแนนครั้งแรกเฉลี่ย · เท่ากันใช้ความไว · ไม่นับชุดที่ตัวเองสร้างหรืออนุมัติ · TG ไม่ติดอันดับ</p>
            {!board.tgExcluded && board.rows.length > 0 && <p className="mb-3 text-[12px] text-danger">ถามรายชื่อ TG จาก WorkID ไม่ได้ — อันดับนี้อาจมี TG ปนอยู่</p>}
            {board.rows.length === 0 ? <EmptyState compact title="ยังไม่มีใครสอบในเดือนนี้" /> : <LeaderboardList board={board} actorPersonId={actor.personId} />}
            {hiddenLine(board.hiddenPeople)}
          </Card>
        </aside>

        <Card padded={false} className="min-w-0 overflow-hidden @5xl:col-start-1 @5xl:row-start-1">
            <SectionTitle className="px-5 py-4" right={<a href={`/dashboard/export?kind=people&${qs}`} className={buttonClass("ghost", "sm")}>Export Excel</a>}>
              สถิติรายคน <span className="ml-1 text-[13px] font-normal tabular-nums text-ink-3">{data.people.length}</span>
            </SectionTitle>
            {data.people.length === 0 ? (
              <div className="border-t border-line">
                <EmptyState compact title="ไม่มีข้อมูลในเดือนนี้" />
              </div>
            ) : (
              <PeopleTable people={data.people} />
            )}
            {hiddenLine(data.hiddenPeople, "คน", true)}
        </Card>

        {/* สถานะรายชุดยาวที่สุดในหน้า — ใช้เต็มกว้างใต้ทั้งสองคอลัมน์ */}
        <Card padded={false} className="min-w-0 overflow-hidden @5xl:col-span-2">
            <SectionTitle
              className="px-5 py-4"
              right={
                <span className="flex items-center gap-1">
                  {groups.length > 1 && (
                    <Link href={href({ hidden: showHidden, open: !expandAll })} className={buttonClass("ghost", "sm")} scroll={false}>
                      {expandAll ? "ยุบทุกชุด" : "เปิดทุกชุด"}
                    </Link>
                  )}
                  <a href={`/dashboard/export?kind=status&${qs}`} className={buttonClass("ghost", "sm")}>
                    Export Excel
                  </a>
                </span>
              }
            >
              สถานะรายชุด <span className="ml-1 text-[13px] font-normal tabular-nums text-ink-3">{groups.length}</span>
            </SectionTitle>
            {data.rows.length === 0 ? (
              <div className="border-t border-line">
                <EmptyState compact title="ไม่มีการมอบในเดือนนี้" />
              </div>
            ) : (
              <SetGroups groups={groups} open={openGroups} now={now} />
            )}
            {hiddenLine(data.hiddenRows, "การมอบ", true)}
        </Card>
      </div>
    </main>
  );
}
