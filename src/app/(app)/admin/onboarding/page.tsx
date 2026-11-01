import Link from "next/link";
import { ne } from "drizzle-orm";
import { buttonClass, Card, EmptyState, FIELD_LABEL_CLASS, PageHeader, SectionTitle, SELECT_CLASS } from "@/components/ui";
import { db } from "@/db";
import { learningSets } from "@/db/schema";
import { listPaths, positionsFromOrg } from "@/lib/onboarding-service";
import { firstParam, pageActor } from "@/lib/page";
import { fetchOrg } from "@/lib/workid";
import { Flash, STATUS } from "../../sets/ui";
import { addPathAction, removePathAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * เส้นทาง Onboarding (spec §6) — TG ผูกชุดเข้ากับตำแหน่ง · admin เท่านั้น
 * ★ ตำแหน่งมาจากผัง WorkID วันนี้ (ยังไม่มีแคตตาล็อก · spec §6.1) — ตำแหน่งที่ยังไม่มีใครจึงยังไม่ขึ้น
 */
export default async function OnboardingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await pageActor(["admin"]);
  const sp = await searchParams;
  const org = await fetchOrg();
  const positions = org.ok ? positionsFromOrg(org.people) : [];
  const paths = await listPaths();
  const sets = await db().select({ id: learningSets.id, title: learningSets.title }).from(learningSets).where(ne(learningSets.status, "closed")).orderBy(learningSets.title);

  const groups = new Map<number, { label: string; rows: typeof paths }>();
  for (const p of paths) {
    const g = groups.get(p.positionId) ?? { label: p.positionLabel, rows: [] };
    g.rows.push(p);
    groups.set(p.positionId, g);
  }

  return (
    <main className="mx-auto max-w-4xl space-y-5 px-4 py-8">
      <PageHeader title="เส้นทาง Onboarding" subtitle="ผูกชุดการเรียนรู้เข้ากับตำแหน่ง — คนในตำแหน่งได้รับมอบเอง และ WorkHR ดึงผลไปติ๊ก checklist" actions={<Link href="/" className="text-[13px] text-ink-3 underline">หน้าแรก</Link>} />
      <Flash msg={firstParam(sp.msg)} err={firstParam(sp.err)} />

      <Card>
        <SectionTitle className="mb-3">ผูกชุดใหม่</SectionTitle>
        {!org.ok && <p className="mb-3 text-[13px] text-danger">ดึงผังจาก WorkID ไม่ได้ ({org.why}) — ลองใหม่อีกครั้ง</p>}
        {org.ok && positions.length === 0 && <p className="mb-3 text-[13px] text-ink-3">ผังยังไม่มีรหัสตำแหน่ง (positionId) — ต้องรอ WorkHR/WorkID ส่งมาก่อน (spec §6.1)</p>}
        <form action={addPathAction} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <label>
            <span className={FIELD_LABEL_CLASS}>ตำแหน่ง</span>
            <select name="position" required className={SELECT_CLASS} defaultValue="">
              <option value="" disabled>
                เลือกตำแหน่ง
              </option>
              {positions.map((p) => (
                <option key={p.positionId} value={`${p.positionId}|${p.label}`}>
                  {p.label} ({p.people} คน)
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className={FIELD_LABEL_CLASS}>ชุดการเรียนรู้</span>
            <select name="setId" required className={SELECT_CLASS} defaultValue="">
              <option value="" disabled>
                เลือกชุด
              </option>
              {sets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={buttonClass("primary")} disabled={!positions.length || !sets.length}>
            ผูก
          </button>
        </form>
      </Card>

      <Card>
        <SectionTitle className="mb-3">เส้นทางที่ผูกไว้</SectionTitle>
        {groups.size === 0 && <EmptyState compact title="ยังไม่ได้ผูกชุดกับตำแหน่งไหน" />}
        <div className="space-y-4">
          {[...groups.entries()].map(([positionId, g]) => (
            <div key={positionId}>
              <p className="mb-1.5 text-[13px] font-semibold text-ink">{g.label}</p>
              <ul className="divide-y divide-line rounded-lg border border-line">
                {g.rows.map((r) => (
                  <li key={r.setId} className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]">
                    <span>
                      <Link href={`/sets/${r.setId}`} className="underline">
                        {r.title}
                      </Link>
                      <span className="ml-2 text-[11px] text-ink-3">{STATUS[r.status].label}</span>
                    </span>
                    <form action={removePathAction}>
                      <input type="hidden" name="positionId" value={positionId} />
                      <input type="hidden" name="setId" value={r.setId} />
                      <button type="submit" className={buttonClass("ghost", "sm")}>
                        ถอดออก
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Card>
    </main>
  );
}
