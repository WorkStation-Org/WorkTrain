import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/ui";
import { formatDuration } from "@/domain/document";
import { myLearningList, type LearningListItem } from "@/lib/learn-service";
import { learnerActor } from "@/lib/page";
import { bangkokDate, formatYmd } from "@/lib/time";
import { type CardFilter, type LearnCard, LearnList } from "./learn-list";

export const dynamic = "force-dynamic";

const day = (d: Date) => formatYmd(bangkokDate(d));

/** การ์ดหนึ่งใบจากข้อมูลของการมอบ — สถานะ · เนื้อหา · ความคืบหน้า · กำหนดส่ง */
function toCard(i: LearningListItem): LearnCard {
  const parts: string[] = [];
  if (i.videos) parts.push(`${i.videos} วิดีโอ · ${formatDuration(i.videoSeconds)}`);
  if (i.pdfs) parts.push(`${i.pdfs} PDF · ${i.pdfPages} หน้า`);
  const percent = i.status === "passed" || i.status === "update" ? 100 : i.unitsTotal ? Math.round((i.unitsSeen / i.unitsTotal) * 100) : 0;
  const badge: LearnCard["badge"] =
    i.status === "passed"
      ? { tone: "success", label: "ผ่านแล้ว" }
      : i.status === "update"
        ? { tone: "warning", label: "มีเวอร์ชันใหม่" }
        : i.late
          ? { tone: "danger", label: "เลยกำหนด" }
          : i.status === "relearn"
            ? { tone: "warning", label: "ต้องอ่านใหม่" }
            : i.status === "ready"
              ? { tone: "neutral", label: "พร้อมสอบ" }
              : i.status === "reading"
                ? { tone: "info", label: "กำลังเรียน" }
                : { tone: "info", label: "ยังไม่เริ่ม" };
  const groups: CardFilter[] = [];
  if (i.passedAt) groups.push("passed");
  else groups.push("open");
  if (i.late) groups.push("late");
  if (i.videos) groups.push("video");
  return {
    href: `/learn/${i.assignmentId}`,
    title: i.title,
    kindName: i.kindName,
    badge,
    contents: parts.join(" · ") || "ยังไม่มีเนื้อหา",
    videoChip: i.videos ? (i.videos > 1 ? `${i.videos} คลิป · ${formatDuration(i.videoSeconds)}` : formatDuration(i.videoSeconds)) : null,
    coverUrl: i.coverUrl,
    hasVideo: i.videos > 0,
    percent,
    progressLabel:
      i.status === "passed"
        ? "สอบผ่านแล้ว"
        : i.status === "update"
          ? "มีเวอร์ชันใหม่ให้ดู"
          : i.status === "ready"
            ? "ดู/อ่านครบ · สอบได้"
            : `ครบ ${i.docsDone}/${i.docsTotal} รายการ · ${percent}%`,
    barTone: i.passedAt ? "success" : i.late ? "danger" : "fg",
    dateLabel: i.passedAt ? `ผ่าน ${day(i.passedAt)}` : i.late ? `เลย ${day(i.dueAt)}` : `ส่ง ${day(i.dueAt)}`,
    groups,
  };
}

/** ชุดการเรียนรู้ที่ได้รับมอบ (spec §9) — สรุปตัวเลข · ทำต่อจากที่ค้างไว้ · แท็บกรอง + ค้นหา · การ์ดพร้อมปกคลิป */
export default async function LearnPage() {
  const actor = await learnerActor();
  const items = await myLearningList(actor.personId);
  const late = items.filter((i) => i.late).length;
  const passed = items.filter((i) => i.passedAt).length;
  const resumeOf = items
    .filter((i) => i.resume)
    .sort((x, y) => y.resume!.at.getTime() - x.resume!.at.getTime())[0];

  return (
    <main className="mx-auto w-full max-w-6xl space-y-5">
      <PageHeader kicker="Your learning" title="ชุดที่ต้องเรียน" subtitle="อ่านเอกสารครบทุกหน้า ดูวิดีโอครบทุกช่วง แล้วสอบให้ผ่าน 80%" />
      {items.length === 0 ? (
        <EmptyState title="ยังไม่มีชุดที่ได้รับมอบ" />
      ) : (
        <>
          <section aria-label="สรุป" className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
            <Summary label="ได้รับมอบทั้งหมด" value={`${items.length} ชุด`} />
            <Summary label="กำลังเรียน" value={items.length - passed - late} />
            <Summary label="เลยกำหนด" value={late} tone={late ? "danger" : undefined} />
            <Summary label="ผ่านแล้ว" value={passed} tone={passed ? "success" : undefined} />
          </section>

          {resumeOf?.resume && <Resume item={resumeOf} />}

          <LearnList cards={items.map(toCard)} />
        </>
      )}
    </main>
  );
}

function Summary({ label, value, tone }: { label: string; value: number | string; tone?: "danger" | "success" }) {
  const box = tone === "danger" ? "border-danger/25 bg-danger-soft" : tone === "success" ? "border-success/25 bg-success-soft" : "border-line bg-raised";
  const text = tone === "danger" ? "text-danger" : tone === "success" ? "text-success" : "text-fg";
  return (
    <div className={`flex flex-col gap-1 rounded-[13px] border px-4 py-3.5 ${box}`}>
      <span className={`text-[12px] ${tone ? text : "text-muted"}`}>{label}</span>
      <span className={`text-[26px] font-bold leading-tight ${text}`}>{value}</span>
    </div>
  );
}

/** แถบ "ทำต่อจากที่ค้างไว้" — เนื้อหาที่ขยับล่าสุดแต่ยังไม่ครบ */
function Resume({ item }: { item: LearningListItem }) {
  const r = item.resume!;
  const percent = r.total ? Math.round((r.seen / r.total) * 100) : 0;
  const remaining = item.docsTotal - item.docsDone;
  return (
    <section aria-label="ทำต่อจากที่ค้างไว้" className="flex flex-wrap items-center gap-5 rounded-2xl bg-accent p-4 text-accent-fg sm:p-5">
      <div className="relative flex aspect-video w-full max-w-60 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-[#2c2e32] sm:w-60">
        {/* eslint-disable-next-line @next/next/no-img-element -- ภาพผ่าน route ที่ตรวจสิทธิ์ ไม่ผ่าน next/image */}
        {r.coverUrl && <img src={r.coverUrl} alt="" className="absolute inset-0 size-full object-cover" />}
        {r.isVideo ? (
          <span className="relative flex size-12 items-center justify-center rounded-full bg-white text-[#161719]">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
        ) : (
          <svg width="34" height="40" viewBox="0 0 40 48" fill="none" stroke="#a4a7ad" strokeWidth="2" aria-hidden>
            <path d="M6 2h20l10 10v34H6z" />
            <path d="M26 2v10h10" />
          </svg>
        )}
        {r.isVideo && r.durationSeconds !== null && (
          <span className="absolute bottom-2.5 right-2 rounded bg-black/60 px-1.5 text-[11px] leading-5 text-white">{formatDuration(r.durationSeconds)}</span>
        )}
        <span className="absolute inset-x-0 bottom-0 h-1 bg-[#45484d]">
          <span className="block h-full bg-white" style={{ width: `${percent}%` }} />
        </span>
      </div>
      <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-1.5">
        <span className="text-[12px] tracking-wider opacity-70">ทำต่อจากที่ค้างไว้</span>
        <span className="text-[19px] font-bold leading-snug">
          {item.title} — {r.fileName}
        </span>
        <span className="text-[13px] opacity-75">
          {r.isVideo ? `ดูแล้ว ${r.seen}/${r.total} ช่วง` : `อ่านแล้ว ${r.seen}/${r.total} หน้า`} · เหลืออีก {remaining} รายการในชุดนี้ · ส่ง {day(item.dueAt)}
        </span>
      </div>
      <Link
        href={`/learn/${item.assignmentId}`}
        className="flex h-11 shrink-0 items-center gap-2 rounded-[10px] bg-accent-fg px-5 text-[14px] font-semibold text-accent hover:opacity-90"
      >
        {r.isVideo ? "ดูต่อ" : "อ่านต่อ"}
      </Link>
    </section>
  );
}
