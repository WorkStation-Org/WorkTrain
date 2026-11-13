import Link from "next/link";
import { Badge, Button, Card, EmptyState, FIELD_LABEL_CLASS, INPUT_CLASS, PageHeader, SELECT_CLASS } from "@/components/ui";
import { firstParam, pageActor } from "@/lib/page";
import { activeKinds, listKinds } from "@/lib/kind-service";
import { canDeleteDraft, listManagedSets, type SetRow } from "@/lib/set-service";
import { formatBangkok } from "@/lib/time";
import { createSetAction } from "./actions";
import { EndSetButton } from "./end-set-button";
import { Flash, STATUS } from "./ui";

export const dynamic = "force-dynamic";

/**
 * ชุดการเรียนรู้ที่คนนี้ทำงานด้วย — ของตัวเอง + ที่เป็นผู้อนุมัติ · TG เห็นทุกชุด
 * ร่างลบได้จากรายการ · ชุดที่ปิดแล้วพับไว้ท้ายรายการ (ADR-0016)
 */
export default async function SetsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await pageActor();
  const sp = await searchParams;
  const all = await listManagedSets(actor);
  const sets = all.filter((s) => s.status !== "closed");
  const closed = all.filter((s) => s.status === "closed");
  const canCreate = actor.role === "admin" || actor.role === "author";
  const kinds = canCreate ? await activeKinds() : [];
  const kindNames = new Map((await listKinds()).map((k) => [k.id, k.name]));

  return (
    <main className="mx-auto w-full max-w-4xl">
      <PageHeader kicker="Library" title="ชุดการเรียนรู้" subtitle="สร้าง · ออกข้อสอบ · อนุมัติ" />
      <Flash msg={firstParam(sp.msg)} err={firstParam(sp.err)} />

      {canCreate && (
        <Card className="mb-5">
          <form action={createSetAction} className="flex flex-wrap items-end gap-3">
            <label className="min-w-60 flex-1">
              <span className={FIELD_LABEL_CLASS}>ชื่อชุด</span>
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
        <EmptyState title="ยังไม่มีชุดการเรียนรู้" />
      ) : (
        <SetList sets={sets} kindNames={kindNames} canDelete={(s) => canDeleteDraft(actor, s)} />
      )}

      {closed.length > 0 && (
        <details className="mt-6">
          <summary className="cursor-pointer text-[13px] text-ink-3">ปิดแล้ว {closed.length} ชุด</summary>
          <div className="mt-3">
            <SetList sets={closed} kindNames={kindNames} canDelete={() => false} />
          </div>
        </details>
      )}
    </main>
  );
}

function SetList({ sets, kindNames, canDelete }: { sets: SetRow[]; kindNames: Map<number, string>; canDelete: (s: SetRow) => boolean }) {
  return (
    <ul className="space-y-2">
      {sets.map((s) => (
        <li key={s.id}>
          <Card className="relative hover:border-ink-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              {/* ลิงก์คลุมทั้งการ์ด (after:inset-0) · ปุ่มลบอยู่ชั้นบนกดแยกได้ */}
              <Link href={`/sets/${s.id}`} className="font-semibold text-ink after:absolute after:inset-0 after:content-['']">
                {s.title}
              </Link>
              <div className="relative z-10 flex items-center gap-2">
                {canDelete(s) && <EndSetButton setId={s.id} title={s.title} mode="delete" />}
                <Badge tone={STATUS[s.status].tone} label={STATUS[s.status].label} />
              </div>
            </div>
            <p className="mt-1 text-[12px] text-ink-3">
              {kindNames.get(s.kindId)} · ผู้สร้าง {s.authorName} · ผู้อนุมัติ {s.approverName ?? "ยังไม่ได้เลือก"} · แก้ล่าสุด {formatBangkok(s.updatedAt)}
            </p>
          </Card>
        </li>
      ))}
    </ul>
  );
}
