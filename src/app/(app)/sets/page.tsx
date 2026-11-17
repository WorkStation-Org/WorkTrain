import { videoChipLabel } from "@/components/set-cover";
import { Button, Card, EmptyState, FIELD_LABEL_CLASS, INPUT_CLASS, PageHeader, SELECT_CLASS } from "@/components/ui";
import { formatDuration } from "@/domain/document";
import { activeKinds } from "@/lib/kind-service";
import { firstParam, pageActor } from "@/lib/page";
import { setsOverview, type SetOverview } from "@/lib/set-overview";
import { canDeleteDraft, pendingSince } from "@/lib/set-service";
import { ageInDays, bangkokDate, formatBangkok, formatYmd } from "@/lib/time";
import { createSetAction } from "./actions";
import { type SetFilter, type SetItem, SetBrowser, type SetView } from "./set-browser";
import { Flash, STATUS } from "./ui";

export const dynamic = "force-dynamic";

const day = (d: Date) => formatYmd(bangkokDate(d));

/**
 * ชุดการเรียนรู้ — หน้าเดียวของทุกชุดที่คนนี้ทำงานด้วย (ของตัวเอง + ที่เป็นผู้อนุมัติ · TG เห็นทุกชุด)
 * แทนสองหน้าเดิม (รายการชุด + ภาพรวมชุดที่ปล่อยแล้ว) · ดูได้สองแบบ: การ์ดปกคลิป (ค่าเริ่มต้น) หรือตาราง (`?view=table`)
 * งานที่รออนุมัติขึ้นก่อน พร้อมบอกว่ารอใครมากี่วัน · TG อนุมัติแทนได้ (ADR-0018) · ร่างลบได้จากตาราง (ADR-0016)
 */
export default async function SetsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await pageActor();
  const sp = await searchParams;
  const view: SetView = firstParam(sp.view) === "table" ? "table" : "cards";
  const now = new Date();
  const sets = await setsOverview(actor, now);
  const pending = await pendingSince(sets.map((s) => ({ id: s.setId, status: s.status })));
  const canCreate = actor.role === "admin" || actor.role === "author";
  const kinds = canCreate ? await activeKinds() : [];

  const active = sets.filter((s) => s.status === "active");
  const learners = active.reduce((n, s) => n + s.learners, 0);
  const passed = active.reduce((n, s) => n + s.counts.passed, 0);
  const overdue = active.reduce((n, s) => n + s.counts.overdue, 0);

  const toItem = (s: SetOverview): SetItem => {
    const p = pending.get(s.setId);
    const waitDays = p ? ageInDays(p.since, now) : 0;
    const waitNote = p
      ? `รอ ${s.approverName ?? "ผู้อนุมัติ"} อนุมัติ${p.what === "version" ? "เวอร์ชันใหม่" : ""} · ${waitDays > 0 ? `รอมา ${waitDays} วัน` : "ส่งวันนี้"}`
      : null;
    const parts: string[] = [];
    if (s.videos) parts.push(`${s.videos} วิดีโอ · ${formatDuration(s.videoSeconds)}`);
    if (s.pdfs) parts.push(`${s.pdfs} PDF · ${s.pdfPages} หน้า`);
    const released = s.releasedAt !== null;
    const dates = !s.releasedAt ? "ยังไม่ปล่อย" : s.status === "closed" && s.closedAt ? `ปล่อย ${day(s.releasedAt)} · ปิด ${day(s.closedAt)}` : `ปล่อย ${day(s.releasedAt)}`;
    const groups: SetFilter[] = [];
    if (p) groups.push("pending");
    if (s.status === "draft") groups.push("draft");
    if (s.status === "active") groups.push("active");
    if (s.status === "closed") groups.push("closed");
    if (s.counts.overdue) groups.push("overdue");
    return {
      id: s.setId,
      // ชุดที่ปล่อยแล้วเปิดที่แท็บผู้เรียน · ยังไม่ปล่อยเปิดขั้นที่ต้องทำต่อ (หน้าชุดเลือกให้เอง)
      href: released ? `/sets/${s.setId}?tab=learners` : `/sets/${s.setId}`,
      title: s.title,
      kindName: s.kindName,
      badge: { tone: STATUS[s.status].tone, label: STATUS[s.status].label },
      note: p?.what === "version" ? null : s.newVersion === "drafting" ? { tone: "info", label: "กำลังทำเวอร์ชันใหม่" } : null,
      waitNote,
      meta: `${s.versionLabel} · ${dates} · ${s.authorName}`,
      contents: parts.join(" · ") || "ยังไม่มีเนื้อหาที่ต้องดู/อ่าน",
      videoChip: videoChipLabel(s.videos, formatDuration(s.videoSeconds)),
      coverUrl: s.coverUrl,
      hasVideo: s.videos > 0,
      released,
      learners: s.learners,
      passed: s.counts.passed,
      started: s.counts.started,
      notStarted: s.counts.not_started,
      overdue: s.counts.overdue,
      authorName: s.authorName,
      approverName: s.approverName,
      updatedLabel: formatBangkok(s.updatedAt),
      canDelete: canDeleteDraft(actor, { authorPersonId: s.authorPersonId, status: s.status }),
      groups,
    };
  };

  return (
    <main className="mx-auto w-full max-w-6xl space-y-5">
      <PageHeader
        title="ชุดการเรียนรู้"
        subtitle={
          actor.role === "admin"
            ? "ทุกชุดในระบบ — สร้าง · ออกข้อสอบ · อนุมัติ · ดูว่าผู้เรียนผ่านกี่คน"
            : "ชุดที่คุณสร้างหรือเป็นผู้อนุมัติ — สร้าง · ออกข้อสอบ · อนุมัติ · ดูว่าผู้เรียนผ่านกี่คน"
        }
      />
      <Flash msg={firstParam(sp.msg)} err={firstParam(sp.err)} />

      {canCreate && (
        <Card>
          <form action={createSetAction} className="flex flex-wrap items-end gap-3">
            <label className="min-w-60 flex-1">
              <span className={FIELD_LABEL_CLASS}>ชื่อชุดใหม่</span>
              <input name="title" required maxLength={200} placeholder="เช่น ขั้นตอนเบิกของ · F331 Signature Collection" className={INPUT_CLASS} />
            </label>
            <label>
              <span className={FIELD_LABEL_CLASS}>ชนิด</span>
              <select name="kindId" required className={SELECT_CLASS} defaultValue={kinds[0]?.id ?? ""}>
                {kinds.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" variant="primary">
              สร้างชุด
            </Button>
          </form>
        </Card>
      )}

      {sets.length === 0 ? (
        <EmptyState title="ยังไม่มีชุดการเรียนรู้" hint={canCreate ? "ตั้งชื่อชุดด้านบนแล้วกดสร้างชุด" : "ชุดที่คุณเป็นผู้อนุมัติจะขึ้นที่นี่"} />
      ) : (
        <>
          {active.length > 0 && (
            <section aria-label="สรุปชุดที่ใช้อยู่" className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
              <Summary label="ชุดที่ใช้อยู่" value={`${active.length} ชุด`} />
              <Summary label="ได้รับมอบ (คน × ชุด)" value={learners} />
              <Summary label="ผ่านแล้ว" value={learners ? `${passed} · ${Math.round((passed / learners) * 100)}%` : passed} tone={passed ? "success" : undefined} />
              <Summary label="เลยกำหนด" value={overdue} tone={overdue ? "danger" : undefined} />
            </section>
          )}
          <SetBrowser items={sets.map(toItem)} initialView={view} />
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
      <span className={`text-[13px] ${tone ? text : "text-muted"}`}>{label}</span>
      <span className={`text-[26px] font-bold leading-tight ${text}`}>{value}</span>
    </div>
  );
}
