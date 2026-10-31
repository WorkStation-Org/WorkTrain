import Link from "next/link";
import { Badge, Button, Card, EmptyState, FIELD_LABEL_CLASS, INPUT_CLASS, PageHeader, SELECT_CLASS } from "@/components/ui";
import { firstParam, pageActor } from "@/lib/page";
import { listManagedSets } from "@/lib/set-service";
import { formatBangkok } from "@/lib/time";
import { createSetAction } from "./actions";
import { Flash, STATUS } from "./ui";

export const dynamic = "force-dynamic";

/** ชุดการเรียนรู้ที่คนนี้ทำงานด้วย — ของตัวเอง + ที่เป็นผู้อนุมัติ · TG เห็นทุกชุด */
export default async function SetsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await pageActor();
  const sp = await searchParams;
  const sets = await listManagedSets(actor);
  const canCreate = actor.role === "admin" || actor.role === "author";

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <PageHeader title="ชุดการเรียนรู้" subtitle="สร้าง · ออกข้อสอบ · อนุมัติ" actions={<Link href="/" className="text-[13px] text-ink-3 underline">หน้าแรก</Link>} />
      <Flash msg={firstParam(sp.msg)} err={firstParam(sp.err)} />

      {canCreate && (
        <Card className="mb-5">
          <form action={createSetAction} className="flex flex-wrap items-end gap-3">
            <label className="min-w-60 flex-1">
              <span className={FIELD_LABEL_CLASS}>ชื่อชุด</span>
              <input name="title" required maxLength={200} placeholder="เช่น F331 Signature Collection" className={INPUT_CLASS} />
            </label>
            <label>
              <span className={FIELD_LABEL_CLASS}>ชนิด</span>
              <select name="kind" className={SELECT_CLASS} defaultValue="product">
                <option value="product">สินค้าใหม่ (PD)</option>
                <option value="general">ทั่วไป</option>
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
        <ul className="space-y-2">
          {sets.map((s) => (
            <li key={s.id}>
              <Link href={`/sets/${s.id}`} className="block">
                <Card className="hover:border-ink-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-ink">{s.title}</span>
                    <Badge tone={STATUS[s.status].tone} label={STATUS[s.status].label} />
                  </div>
                  <p className="mt-1 text-[12px] text-ink-3">
                    ผู้สร้าง {s.authorName} · ผู้อนุมัติ {s.approverName ?? "ยังไม่ได้เลือก"} · แก้ล่าสุด {formatBangkok(s.updatedAt)}
                  </p>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
