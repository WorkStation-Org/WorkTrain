import Link from "next/link";
import { videoChipLabel } from "@/components/set-cover";
import { EmptyState, PageHeader } from "@/components/ui";
import { formatDuration, VIDEO_SEGMENT_SECONDS } from "@/domain/document";
import { myLearningList, type LearningListItem } from "@/lib/learn-service";
import { learnerActor } from "@/lib/page";
import { formatThaiDay, relativeDue } from "@/lib/time";
import { type CardFilter, type LearnCard, LearnList } from "./learn-list";

export const dynamic = "force-dynamic";

/** ป้ายสถานะ — บอกว่าตอนนี้ต้องทำอะไร ไม่ใช่สถานะภายในของระบบ */
function badgeOf(i: LearningListItem): LearnCard["badge"] {
  switch (i.status) {
    case "passed":
      return { tone: "success", label: "ผ่านแล้ว" };
    case "update":
      return { tone: "warning", label: i.updateKind === "large" ? "ต้องสอบเพิ่ม" : "ต้องอ่านรับทราบ" };
    case "relearn":
      return { tone: "warning", label: "ต้องทบทวน" };
    case "ready":
      return { tone: "info", label: "พร้อมสอบ" };
    case "reading":
      return { tone: "neutral", label: "กำลังเรียน" };
    default:
      return { tone: "neutral", label: "ยังไม่เริ่ม" };
  }
}

/** บรรทัดขั้นต่อไปใต้แถบความคืบหน้า */
function nextStepOf(i: LearningListItem): string {
  switch (i.status) {
    case "passed":
      return "สอบผ่านแล้ว";
    case "update":
      return i.updateKind === "large" ? "เอกสารอัปเดต · สอบเพิ่มเฉพาะส่วนที่เปลี่ยน" : "เอกสารอัปเดต · อ่านแล้วกดรับทราบ ไม่ต้องสอบ";
    case "ready":
      return "ดู/อ่านครบแล้ว · สอบได้เลย";
    case "relearn":
      return `สอบไม่ผ่าน 2 ครั้งติด · ดู/อ่านใหม่ ${i.docsDone}/${i.docsTotal} รายการ`;
    case "reading":
      return `ดู/อ่านแล้ว ${i.docsDone}/${i.docsTotal} รายการ`;
    default:
      return `ยังไม่เริ่ม · ${i.docsTotal} รายการ`;
  }
}

/** การ์ดหนึ่งใบจากข้อมูลของการมอบ — สถานะ · เนื้อหา · ความคืบหน้า · กำหนด */
function toCard(i: LearningListItem, now: Date): LearnCard {
  const parts: string[] = [];
  if (i.videos) parts.push(`${i.videos} คลิป · ${formatDuration(i.videoSeconds)}`);
  if (i.pdfs) parts.push(`${i.pdfs} PDF · ${i.pdfPages} หน้า`);
  const percent = i.status === "passed" || i.status === "update" ? 100 : i.unitsTotal ? Math.round((i.unitsSeen / i.unitsTotal) * 100) : 0;
  const groups: CardFilter[] = [];
  if (i.passedAt) groups.push("passed");
  else groups.push("open");
  if (i.late) groups.push("late");
  if (i.videos) groups.push("video");
  return {
    href: `/learn/${i.assignmentId}`,
    title: i.title,
    kindName: i.kindName,
    badge: badgeOf(i),
    contents: parts.join(" · ") || "ยังไม่มีเนื้อหา",
    videoChip: videoChipLabel(i.videos, formatDuration(i.videoSeconds)),
    coverUrl: i.coverUrl,
    hasVideo: i.videos > 0,
    percent,
    progressLabel: nextStepOf(i),
    barTone: i.passedAt ? "success" : i.late ? "danger" : "fg",
    dateLabel: i.passedAt
      ? `ผ่านเมื่อ ${formatThaiDay(i.passedAt, now)}`
      : i.late
        ? `${relativeDue(i.dueAt, now)} (ครบกำหนด ${formatThaiDay(i.dueAt, now)})`
        : `ต้องสอบผ่านภายใน ${formatThaiDay(i.dueAt, now)} · ${relativeDue(i.dueAt, now)}`,
    dateTone: i.passedAt ? "muted" : i.late ? "danger" : "fg",
    groups,
  };
}

/** ชุดการเรียนรู้ที่ได้รับมอบ (spec §9) — สรุปตัวเลข (นับแบบเดียวกับหน้าแรก) · ทำต่อจากที่ค้างไว้ · แท็บกรอง + ค้นหา · การ์ดพร้อมปกคลิป */
export default async function LearnPage() {
  const actor = await learnerActor();
  const now = new Date();
  const items = await myLearningList(actor.personId, now);
  const open = items.filter((i) => !i.passedAt).length;
  const late = items.filter((i) => i.late).length;
  const passed = items.filter((i) => i.passedAt).length;
  const resumeOf = items
    .filter((i) => i.resume)
    .sort((x, y) => y.resume!.at.getTime() - x.resume!.at.getTime())[0];

  return (
    <main className="mx-auto w-full max-w-6xl space-y-5">
      <PageHeader title="ชุดที่ต้องเรียน" subtitle="ดูคลิปและอ่านเอกสารให้ครบ แล้วสอบให้ผ่าน — ทำต่อจากที่ค้างไว้ได้ทุกเมื่อ" />
      {items.length === 0 ? (
        <EmptyState title="ยังไม่มีชุดที่ต้องเรียน" hint="ชุดใหม่ที่ได้รับมอบจะขึ้นที่นี่ และแจ้งทาง LINE" />
      ) : (
        <>
          {/* นับแบบเดียวกับหน้าแรก: ยังไม่ผ่าน (รวมที่เลยกำหนด) · ในนั้นเลยกำหนดกี่ชุด · ผ่านแล้ว */}
          <section aria-label="สรุป" className="grid grid-cols-3 gap-2 sm:gap-3">
            <Summary label="ยังไม่ผ่าน" value={open} />
            <Summary label="เลยกำหนด" value={late} tone={late ? "danger" : undefined} />
            <Summary label="ผ่านแล้ว" value={passed} tone={passed ? "success" : undefined} />
          </section>

          {resumeOf?.resume && <Resume item={resumeOf} now={now} />}

          <LearnList cards={items.map((i) => toCard(i, now))} />
        </>
      )}
    </main>
  );
}

function Summary({ label, value, tone }: { label: string; value: number; tone?: "danger" | "success" }) {
  const box = tone === "danger" ? "border-danger/25 bg-danger-soft" : tone === "success" ? "border-success/25 bg-success-soft" : "border-line bg-raised";
  const text = tone === "danger" ? "text-danger" : tone === "success" ? "text-success" : "text-fg";
  return (
    <div className={`flex flex-col gap-1 rounded-[13px] border px-3.5 py-3 sm:px-4 sm:py-3.5 ${box}`}>
      <span className={`text-[13px] ${tone ? text : "text-muted"}`}>{label}</span>
      <span className={`text-[26px] font-bold leading-tight tabular-nums ${text}`}>
        {value} <span className="text-[14px] font-medium">ชุด</span>
      </span>
    </div>
  );
}

/** แถบ "ทำต่อจากที่ค้างไว้" — เนื้อหาที่ขยับล่าสุดแต่ยังไม่ครบ · บอกเป็นเวลา/หน้า ไม่ใช่ "ช่วง" */
function Resume({ item, now }: { item: LearningListItem; now: Date }) {
  const r = item.resume!;
  const percent = r.total ? Math.round((r.seen / r.total) * 100) : 0;
  const remaining = item.docsTotal - item.docsDone;
  const length = r.durationSeconds ?? r.total * VIDEO_SEGMENT_SECONDS;
  const watched = Math.min(length, r.seen * VIDEO_SEGMENT_SECONDS);
  const name = r.ep ? `EP.${r.ep} ${r.fileName}` : r.fileName;
  return (
    <section aria-label="ทำต่อจากที่ค้างไว้" className="flex flex-wrap items-center gap-5 rounded-2xl bg-accent p-4 text-accent-fg sm:p-5">
      <div className="relative flex aspect-video w-full max-w-60 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-[#2c2e32] sm:w-60">
        {/* eslint-disable-next-line @next/next/no-img-element -- ภาพผ่าน route ที่ตรวจสิทธิ์ ไม่ผ่าน next/image */}
        {r.coverUrl && <img src={r.coverUrl} alt="" className={`absolute inset-0 size-full object-cover ${r.isVideo ? "" : "object-top"}`} />}
        {r.isVideo ? (
          <span className="relative flex size-12 items-center justify-center rounded-full bg-white text-[#161719]">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
        ) : r.coverUrl ? null : (
          <svg width="34" height="40" viewBox="0 0 40 48" fill="none" stroke="#a4a7ad" strokeWidth="2" aria-hidden>
            <path d="M6 2h20l10 10v34H6z" />
            <path d="M26 2v10h10" />
          </svg>
        )}
        <span className="absolute inset-x-0 bottom-0 h-1 bg-[#45484d]">
          <span className="block h-full bg-white" style={{ width: `${percent}%` }} />
        </span>
      </div>
      <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-1.5">
        <span className="text-[13px] opacity-75">ทำต่อจากที่ค้างไว้ · {item.title}</span>
        <span className="text-[19px] font-bold leading-snug">{name}</span>
        <span className="text-[14px] opacity-80">
          {r.isVideo
            ? `ดูแล้ว ${formatDuration(watched)} จาก ${formatDuration(length)} · เหลือ ${formatDuration(length - watched)}`
            : `อ่านแล้ว ${r.seen} จาก ${r.total} หน้า`}
          {remaining > 1 ? ` · ชุดนี้เหลืออีก ${remaining} รายการ` : ""}
        </span>
        <span className="text-[13px] opacity-75">
          ต้องสอบผ่านภายใน {formatThaiDay(item.dueAt, now)} · {relativeDue(item.dueAt, now)}
        </span>
      </div>
      <Link
        href={`/learn/${item.assignmentId}`}
        className="flex h-12 shrink-0 items-center gap-2 rounded-[10px] bg-accent-fg px-5 text-[15px] font-semibold text-accent hover:opacity-90"
      >
        {r.isVideo ? `ดูต่อ${r.ep ? ` EP.${r.ep}` : ""}` : "อ่านต่อ"}
      </Link>
    </section>
  );
}
