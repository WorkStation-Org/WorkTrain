import Link from "next/link";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { myAssignments } from "@/lib/learn-service";
import { learnerActor } from "@/lib/page";
import { formatBangkok } from "@/lib/time";

export const dynamic = "force-dynamic";

/** ชุดการเรียนรู้ที่ได้รับมอบ (spec §9) */
export default async function LearnPage() {
  const actor = await learnerActor();
  const rows = await myAssignments(actor.personId);
  const now = new Date();
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <PageHeader
        title="ชุดที่ต้องเรียน"
        subtitle="อ่านเอกสารให้ครบทุกหน้า แล้วสอบให้ผ่าน 80%"
        actions={<Link href="/" className="text-[13px] text-ink-3 underline">หน้าแรก</Link>}
      />
      {rows.length === 0 ? (
        <EmptyState title="ยังไม่มีชุดที่ได้รับมอบ" />
      ) : (
        <ul className="space-y-2">
          {rows.map(({ a, title }) => (
            <li key={a.id}>
              <Link href={`/learn/${a.id}`} className="block">
                <Card className="hover:border-ink-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-ink">{title}</span>
                    {a.passedAt ? (
                      <Badge tone="success" label="ผ่านแล้ว" />
                    ) : a.dueAt <= now ? (
                      <Badge tone="danger" label="เลยกำหนด" />
                    ) : a.relearnRequiredAt ? (
                      <Badge tone="warning" label="ต้องอ่านใหม่" />
                    ) : (
                      <Badge tone="info" label="ยังไม่ผ่าน" />
                    )}
                  </div>
                  <p className="mt-1 text-[12px] text-ink-3">กำหนดส่ง {formatBangkok(a.dueAt)}</p>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
