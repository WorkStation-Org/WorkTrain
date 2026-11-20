import type { ReactNode } from "react";
import { Badge, type BadgeTone } from "@/components/ui";
import { formatSpeed } from "@/domain/stats";
import { withNickname, type PersonLabel } from "@/lib/person-name";
import { PROGRESS_LABEL, type Dashboard, type LeaderboardView, type SetProgress, type StatusRow } from "@/lib/stats-service";
import { bangkokDate, formatBangkok, formatThaiDay } from "@/lib/time";

/**
 * ชิ้นส่วนของหน้า Dashboard — server component ล้วน
 *
 * ★ ความกว้างตัดสินจากกรอบของหน้าเอง (`@container` ที่ `<main>`) ไม่ใช่ความกว้างจอ — เมนูซ้ายยุบ/ขยายได้
 *   จอเดียวกันจึงได้พื้นที่ต่างกัน 170px
 * ★ ตารางอยู่ชิดขอบการ์ด (ไม่ซ้อนกรอบ) · คอลัมน์ชื่อตรึงไว้ทางซ้ายเมื่อเลื่อนตารางแนวนอนบนแท็บเล็ต
 */

export const PROGRESS_ORDER: SetProgress[] = ["passed", "tried", "opened", "not_opened"];

export const PROGRESS_TONE: Record<SetProgress, BadgeTone> = { not_opened: "neutral", opened: "info", tried: "warning", passed: "success" };

/** สีของแต่ละช่วงในแถบ — เรียงเข้มไปจาง ตามความคืบหน้า */
const SEGMENT: Record<SetProgress, string> = {
  passed: "bg-success",
  tried: "bg-warn",
  opened: "bg-ink-4",
  not_opened: "bg-line-strong",
};

export type ProgressCounts = Record<SetProgress, number> & { total: number; overdue: number };

/** นับสถานะของแถวการมอบ · เลยกำหนด = ยังไม่ผ่านและเลยวันกำหนดส่งแล้ว (นิยามเดียวกับ `assignmentState()`) */
export function countProgress(rows: readonly Pick<StatusRow, "progress" | "passedAt" | "dueAt">[], now: Date): ProgressCounts {
  const c: ProgressCounts = { passed: 0, tried: 0, opened: 0, not_opened: 0, total: rows.length, overdue: 0 };
  for (const r of rows) {
    c[r.progress] += 1;
    if (!r.passedAt && r.dueAt <= now) c.overdue += 1;
  }
  return c;
}

const pct = (n: number, total: number) => (total ? Math.round((n / total) * 100) : 0);

/** แถบสัดส่วนสถานะ — ข้อความจริงอยู่ที่ตัวเลขข้าง ๆ แถบเป็นภาพประกอบ (aria-hidden) */
export function ProgressMix({ counts, thin = false }: { counts: ProgressCounts; thin?: boolean }) {
  return (
    <div aria-hidden className={`flex w-full overflow-hidden rounded-full bg-subtle ${thin ? "h-1.5" : "h-2.5"}`}>
      {PROGRESS_ORDER.map((p) =>
        counts[p] ? <span key={p} className={`${SEGMENT[p]} h-full border-r-2 border-raised last:border-r-0`} style={{ width: `${(counts[p] / counts.total) * 100}%` }} /> : null,
      )}
    </div>
  );
}

/** สรุปสถานะการมอบตามตัวกรอง — อ่านก่อนลงไปดูตาราง */
export function StatusSummary({ counts }: { counts: ProgressCounts }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-semibold text-fg">สถานะการมอบ</h2>
        <p className="text-[12px] text-ink-3">
          <span className="tabular-nums">{counts.total}</span> การมอบ
        </p>
      </div>
      {counts.total === 0 ? (
        <p className="mt-3 text-[13px] text-ink-3">ไม่มีการมอบในเดือนนี้</p>
      ) : (
        <>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-[28px] leading-none font-semibold tabular-nums text-fg">{pct(counts.passed, counts.total)}%</span>
            <span className="text-[13px] text-ink-3">ผ่านแล้ว</span>
          </div>
          <div className="mt-3">
            <ProgressMix counts={counts} />
          </div>
          <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
            {PROGRESS_ORDER.map((p) => (
              <li key={p} className="flex min-w-0 items-center gap-2">
                <span aria-hidden className={`size-2 shrink-0 rounded-full ${SEGMENT[p]}`} />
                <span className="min-w-0 flex-1 truncate text-ink-2">{PROGRESS_LABEL[p]}</span>
                <span className="font-medium tabular-nums text-fg">{counts[p]}</span>
              </li>
            ))}
          </ul>
          {counts.overdue > 0 && (
            <p className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-3 text-[13px]">
              <span className="text-danger">เลยกำหนดส่ง ยังไม่ผ่าน</span>
              <span className="font-semibold tabular-nums text-danger">{counts.overdue}</span>
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** ชื่อสองบรรทัด: ชื่อ-สกุล (ชื่อเล่น) / ทีม — ใช้ในที่แคบ (รายชื่ออันดับ · คอลัมน์ที่ตรึงไว้) */
function PersonCell({ label, strong = false }: { label: PersonLabel; strong?: boolean }) {
  return (
    <span className="block min-w-0">
      <span className={`block truncate text-fg ${strong ? "font-semibold" : ""}`}>{withNickname(label)}</span>
      {label.team && <span className="block truncate text-[11px] text-ink-3">{label.team}</span>}
    </span>
  );
}

/** Leaderboard Top 10 — รายการแคบที่ยืดได้ (แถบขวาบนจอกว้าง · ครึ่งแถวบนแท็บเล็ต) */
export function LeaderboardList({ board, actorPersonId }: { board: LeaderboardView; actorPersonId: number }) {
  return (
    <ol className="-mx-2">
      {board.rows.map((r) => {
        const me = r.personId === actorPersonId;
        return (
          <li key={r.personId} className={`flex items-center gap-3 rounded-lg px-2 py-2 text-[13px] ${me ? "bg-subtle" : ""}`} aria-current={me ? "true" : undefined}>
            <span className={`w-5 shrink-0 text-right tabular-nums ${r.rank <= 3 ? "font-semibold text-fg" : "text-ink-3"}`}>{r.rank}</span>
            <span className="min-w-0 flex-1">
              <PersonCell label={r.label} strong={me} />
            </span>
            <span className="shrink-0 text-right">
              <span className="block font-semibold tabular-nums text-fg">{r.firstScore}%</span>
              <span className="block text-[11px] whitespace-nowrap text-ink-3">{formatSpeed(r.speedHours)}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/* ---------- ตาราง ---------- */

const TH_CLS = "px-3 py-2.5 align-bottom text-xs leading-tight font-medium text-ink-3 first:pl-5 last:pr-5";
const TD_CLS = "px-3 py-2.5 first:pl-5 last:pr-5";
/** คอลัมน์แรกตรึงซ้าย — พื้นต้องทึบและเปลี่ยนตามแถวตอนชี้ */
const STICKY = "sticky left-0 z-[1] bg-raised group-hover:bg-subtle";

function Th({ children, num = false, sticky = false, className = "" }: { children: ReactNode; num?: boolean; sticky?: boolean; className?: string }) {
  return <th className={`${TH_CLS} ${num ? "text-right" : "text-left"} ${sticky ? "sticky left-0 z-[1] bg-raised" : ""} ${className}`}>{children}</th>;
}

function Td({ children, num = false, sticky = false, className = "" }: { children: ReactNode; num?: boolean; sticky?: boolean; className?: string }) {
  return <td className={`${TD_CLS} ${num ? "text-right tabular-nums whitespace-nowrap" : ""} ${sticky ? STICKY : ""} ${className}`}>{children}</td>;
}

function Grid({ children, minWidth }: { children: ReactNode; minWidth: string }) {
  return (
    <div className="thin-scroll overflow-x-auto border-t border-line">
      <table className={`w-full text-left text-[13px] ${minWidth}`}>{children}</table>
    </div>
  );
}

const dash = (v: number | null) => v ?? "—";

/** สถิติรายคน — 8 คอลัมน์ ชื่อตรึงซ้าย ตัวเลขชิดขวาแบบตัวเลขกว้างเท่ากัน */
export function PeopleTable({ people }: { people: Dashboard["people"] }) {
  return (
    <Grid minWidth="min-w-[680px]">
      <thead className="border-b border-line">
        <tr>
          <Th sticky>ชื่อ</Th>
          <Th num>ได้รับมอบ</Th>
          <Th num>ผ่าน</Th>
          <Th num>คะแนนครั้งแรก</Th>
          <Th num>คะแนนเฉลี่ย</Th>
          <Th num>ครั้งที่สอบ</Th>
          <Th num>ความไว</Th>
          <Th num>ออกจากหน้าสอบ</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {people.map((p) => (
          <tr key={p.personId} className="group transition-colors hover:bg-subtle">
            <Td sticky className="max-w-[16rem]">
              <PersonCell label={p.label} />
            </Td>
            <Td num>{p.assigned}</Td>
            <Td num>{p.passed}</Td>
            <Td num>{dash(p.firstScore)}</Td>
            <Td num>{dash(p.avgScore)}</Td>
            <Td num>{p.attempts}</Td>
            <Td num>{formatSpeed(p.speedHours)}</Td>
            <Td num>{p.leaves}</Td>
          </tr>
        ))}
      </tbody>
    </Grid>
  );
}

export type GroupBy = "set" | "person";

export interface StatusGroup {
  key: number;
  title: string;
  /** บรรทัดรองใต้หัวกลุ่ม — ทีมของคน (จัดตามคน) */
  sub: string | null;
  rows: StatusRow[];
  counts: ProgressCounts;
}

/** แถวสถานะ → กลุ่มต่อชุดหรือต่อคน · ลำดับกลุ่มตามลำดับแถวที่ service เรียงมาแล้ว */
export function groupRows(rows: readonly StatusRow[], by: GroupBy, now: Date): StatusGroup[] {
  const groups = new Map<number, StatusRow[]>();
  for (const r of rows) {
    const k = by === "set" ? r.setId : r.personId;
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }
  return [...groups.entries()].map(([key, rs]) => ({
    key,
    title: by === "set" ? rs[0].setTitle : withNickname(rs[0].label),
    sub: by === "set" ? null : rs[0].label.team,
    rows: rs,
    counts: countProgress(rs, now),
  }));
}

function When({ d, now, className = "" }: { d: Date; now: Date; className?: string }) {
  return (
    <time dateTime={bangkokDate(d)} title={formatBangkok(d)} className={className}>
      {formatThaiDay(d, now)}
    </time>
  );
}

/**
 * สถานะการมอบเป็นกลุ่ม — ชุดละกลุ่ม (ใครยังค้างในชุดนี้) หรือคนละกลุ่ม (คนนี้เรียนอะไรไปแล้ว)
 * หัวกลุ่มบอกสัดส่วนในบรรทัดเดียว กดเปิดดูรายการ
 * ★ `<details>` ของจริง: คีย์บอร์ดเปิดได้ · ค้นหาในหน้า (Ctrl+F) เปิดกลุ่มที่เจอให้เอง
 */
export function StatusGroups({ groups, by, open, now }: { groups: StatusGroup[]; by: GroupBy; open: boolean; now: Date }) {
  return (
    <div className="divide-y divide-line border-t border-line">
      {groups.map((g) => (
        <details key={g.key} open={open} className="group/set">
          <summary className="flex cursor-pointer list-none items-center gap-x-4 gap-y-2 px-5 py-3.5 transition-colors hover:bg-subtle [&::-webkit-details-marker]:hidden @max-xl:flex-wrap">
            <svg aria-hidden viewBox="0 0 16 16" className="size-4 shrink-0 text-ink-3 transition-transform duration-200 group-open/set:rotate-90">
              <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-fg">{g.title}</span>
              {g.sub && <span className="block truncate text-[11px] text-ink-3">{g.sub}</span>}
            </span>
            <span className="flex w-full items-center gap-3 pl-8 @xl:w-auto @xl:pl-0">
              <span className="w-28 shrink-0 @3xl:w-40">
                <ProgressMix counts={g.counts} thin />
              </span>
              <span className="text-[12px] whitespace-nowrap text-ink-3 @xl:w-[10.5rem]">
                ผ่าน{" "}
                <span className="font-medium tabular-nums text-fg">
                  {g.counts.passed}/{g.counts.total}
                </span>
                {g.counts.overdue > 0 && (
                  <>
                    {" · "}
                    <span className="text-danger">
                      เลยกำหนด <span className="tabular-nums">{g.counts.overdue}</span>
                    </span>
                  </>
                )}
              </span>
            </span>
          </summary>
          <Grid minWidth="min-w-[660px]">
            <thead className="border-b border-line">
              <tr>
                <Th sticky>{by === "set" ? "ชื่อ" : "ชุด"}</Th>
                <Th>ได้รับมอบ</Th>
                <Th>กำหนดส่ง</Th>
                <Th>ผ่านเมื่อ</Th>
                <Th>สถานะ</Th>
                <Th num>ครั้งที่สอบ</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {g.rows.map((r) => {
                const overdue = !r.passedAt && r.dueAt <= now;
                return (
                  <tr key={r.assignmentId} className="group transition-colors hover:bg-subtle">
                    <Td sticky className="max-w-[18rem]">
                      {by === "set" ? <PersonCell label={r.label} /> : <span className="block truncate text-fg">{r.setTitle}</span>}
                    </Td>
                    <Td className="whitespace-nowrap text-ink-2">
                      <When d={r.assignedAt} now={now} />
                    </Td>
                    <Td className={`whitespace-nowrap ${overdue ? "text-danger" : "text-ink-2"}`}>
                      <When d={r.dueAt} now={now} />
                      {overdue && <span className="ml-1.5 text-[11px]">เลยกำหนด</span>}
                    </Td>
                    <Td className="whitespace-nowrap text-ink-2">{r.passedAt ? <When d={r.passedAt} now={now} /> : <span className="text-ink-4">—</span>}</Td>
                    <Td>
                      <Badge tone={PROGRESS_TONE[r.progress]} label={PROGRESS_LABEL[r.progress]} />
                    </Td>
                    <Td num>{r.attempts}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Grid>
        </details>
      ))}
    </div>
  );
}
