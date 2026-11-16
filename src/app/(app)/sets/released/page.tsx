import { videoChipLabel } from "@/components/set-cover";
import { EmptyState, PageHeader } from "@/components/ui";
import { formatDuration } from "@/domain/document";
import { pageActor } from "@/lib/page";
import { releasedSets, type ReleasedSet } from "@/lib/set-overview";
import { bangkokDate, formatYmd } from "@/lib/time";
import { STATUS } from "../ui";
import { type ReleasedCard, type ReleasedFilter, ReleasedList } from "./released-list";

export const dynamic = "force-dynamic";

const day = (d: Date) => formatYmd(bangkokDate(d));

function toCard(s: ReleasedSet): ReleasedCard {
  const parts: string[] = [];
  if (s.videos) parts.push(`${s.videos} วิดีโอ · ${formatDuration(s.videoSeconds)}`);
  if (s.pdfs) parts.push(`${s.pdfs} PDF · ${s.pdfPages} หน้า`);
  const groups: ReleasedFilter[] = [s.status === "active" ? "active" : "closed"];
  if (s.counts.overdue) groups.push("overdue");
  if (s.learners > 0 && s.counts.passed === s.learners) groups.push("complete");
  const dates = s.status === "closed" && s.closedAt ? `ปล่อย ${day(s.releasedAt)} · ปิด ${day(s.closedAt)}` : `ปล่อย ${day(s.releasedAt)}`;
  return {
    href: `/sets/${s.setId}?tab=learners`,
    title: s.title,
    kindName: s.kindName,
    badge: { tone: STATUS[s.status].tone, label: STATUS[s.status].label },
    note:
      s.newVersion === "submitted"
        ? { tone: "warning", label: "เวอร์ชันใหม่รออนุมัติ" }
        : s.newVersion === "drafting"
          ? { tone: "info", label: "กำลังทำเวอร์ชันใหม่" }
          : null,
    meta: `${s.versionLabel} · ${dates} · ${s.authorName}`,
    contents: parts.join(" · ") || "ไม่มีเนื้อหาที่ต้องดู/อ่าน",
    videoChip: videoChipLabel(s.videos, formatDuration(s.videoSeconds)),
    coverUrl: s.coverUrl,
    hasVideo: s.videos > 0,
    learners: s.learners,
    passed: s.counts.passed,
    started: s.counts.started,
    notStarted: s.counts.not_started,
    overdue: s.counts.overdue,
    groups,
  };
}

/**
 * ภาพรวมชุดที่ปล่อยแล้ว — ชุดที่อนุมัติแล้วทีละการ์ด ว่ามอบให้กี่คน ผ่านกี่คน ใครเลยกำหนด (ผู้สร้าง · ผู้อนุมัติ · TG)
 * กดการ์ด = แท็บผู้เรียนของชุดนั้น
 */
export default async function ReleasedSetsPage() {
  const actor = await pageActor();
  const sets = await releasedSets(actor);
  const active = sets.filter((s) => s.status === "active");
  const learners = active.reduce((n, s) => n + s.learners, 0);
  const passed = active.reduce((n, s) => n + s.counts.passed, 0);
  const overdue = active.reduce((n, s) => n + s.counts.overdue, 0);

  return (
    <main className="mx-auto w-full max-w-6xl space-y-5">
      <PageHeader
        kicker="Overview"
        title="ชุดที่ปล่อยแล้ว"
        subtitle={
          actor.role === "admin" ? "ชุดที่อนุมัติแล้วทั้งหมด — มอบให้กี่คน ผ่านกี่คน ใครเลยกำหนด" : "ชุดที่คุณสร้างหรืออนุมัติ — มอบให้กี่คน ผ่านกี่คน ใครเลยกำหนด"
        }
      />
      {sets.length === 0 ? (
        <EmptyState title="ยังไม่มีชุดที่ปล่อยแล้ว" hint="ชุดที่ผ่านการอนุมัติจะขึ้นที่นี่" />
      ) : (
        <>
          <section aria-label="สรุปชุดที่ใช้อยู่" className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
            <Summary label="ชุดที่ใช้อยู่" value={`${active.length} ชุด`} />
            <Summary label="ได้รับมอบ (คน × ชุด)" value={learners} />
            <Summary label="ผ่านแล้ว" value={learners ? `${passed} · ${Math.round((passed / learners) * 100)}%` : passed} tone={passed ? "success" : undefined} />
            <Summary label="เลยกำหนด" value={overdue} tone={overdue ? "danger" : undefined} />
          </section>
          <ReleasedList cards={sets.map(toCard)} />
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
