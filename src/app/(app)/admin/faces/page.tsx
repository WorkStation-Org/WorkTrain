import Link from "next/link";
import { buttonClass, Card, EmptyState, PageHeader, SectionTitle } from "@/components/ui";
import { faceImageLink, reviewQueue } from "@/lib/identity-service";
import { firstParam, pageActor } from "@/lib/page";
import { formatBangkok } from "@/lib/time";
import { fetchOrg } from "@/lib/workid";
import { Flash } from "../../sets/ui";
import { reviewEnrollmentAction, reviewScansAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * คิวตรวจภาพของ TG (spec §8) — สแกนไม่ผ่าน 3 ครั้งติด · คำขอลงทะเบียนใบหน้าใหม่
 * ★ ภาพเปิดด้วยลิงก์อายุสั้น ไม่เก็บลิงก์ไว้ที่ไหน · หน้านี้ admin เท่านั้น
 */
export default async function FacesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await pageActor(["admin"]);
  const sp = await searchParams;
  const { scanReviews, enrollments } = await reviewQueue();
  const org = await fetchOrg();
  const nameOf = (id: number) => (org.ok ? org.people.find((p) => p.personId === id)?.name : null) ?? `personId ${id}`;
  const link = async (key: string | null) => (key ? await faceImageLink(key) : null);

  const scanCards = await Promise.all(
    scanReviews.map(async (r) => ({ ...r, images: await Promise.all(r.scans.map(async (s) => ({ s, url: await link(s.objectKey) }))) })),
  );
  const enrollCards = await Promise.all(enrollments.map(async (e) => ({ e, url: await link(e.objectKey) })));

  return (
    <main className="mx-auto max-w-4xl space-y-5 px-4 py-8">
      <PageHeader title="ตรวจภาพใบหน้า" subtitle="สแกนไม่ผ่าน 3 ครั้งติด · คำขอลงทะเบียนใหม่" actions={<Link href="/" className="text-[13px] text-ink-3 underline">หน้าแรก</Link>} />
      <Flash msg={firstParam(sp.msg)} err={firstParam(sp.err)} />

      <Card>
        <SectionTitle className="mb-3">สแกนไม่ผ่านติดกัน ({scanCards.length})</SectionTitle>
        {scanCards.length === 0 && <EmptyState compact title="ไม่มีรายการรอตรวจ" />}
        <div className="space-y-4">
          {scanCards.map((r) => (
            <div key={r.personId} className="rounded-lg border border-line p-3">
              <p className="mb-2 text-[13px] font-semibold">{nameOf(r.personId)}</p>
              <div className="mb-3 flex flex-wrap gap-2">
                {r.images.map(({ s, url }) => (
                  <figure key={s.id} className="w-32 text-[11px] text-ink-3">
                    {url ? <img src={url} alt="" className="h-32 w-32 rounded object-cover" /> : <div className="flex h-32 w-32 items-center justify-center rounded bg-surface-2">ไม่มีภาพ</div>}
                    <figcaption>
                      {formatBangkok(s.createdAt)} · {s.result}
                      {s.similarity ? ` · ${s.similarity}%` : ""}
                    </figcaption>
                  </figure>
                ))}
              </div>
              <form action={reviewScansAction} className="flex gap-2">
                <input type="hidden" name="personId" value={r.personId} />
                <button type="submit" name="decision" value="confirm" className={buttonClass("primary", "sm")}>
                  ใช่ตัวจริง
                </button>
                <button type="submit" name="decision" value="reject" className={buttonClass("danger", "sm")}>
                  ไม่ใช่
                </button>
              </form>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <SectionTitle className="mb-3">คำขอลงทะเบียนใบหน้าใหม่ ({enrollCards.length})</SectionTitle>
        {enrollCards.length === 0 && <EmptyState compact title="ไม่มีคำขอ" />}
        <div className="space-y-4">
          {enrollCards.map(({ e, url }) => (
            <div key={e.id} className="flex flex-wrap items-center gap-4 rounded-lg border border-line p-3">
              {url ? <img src={url} alt="" className="h-32 w-32 rounded object-cover" /> : <div className="h-32 w-32 rounded bg-surface-2" />}
              <div className="space-y-2 text-[13px]">
                <p className="font-semibold">{nameOf(e.personId)}</p>
                <p className="text-ink-3">ขอเมื่อ {formatBangkok(e.createdAt)} — เทียบกับคนจริงก่อนอนุมัติ</p>
                <form action={reviewEnrollmentAction} className="flex gap-2">
                  <input type="hidden" name="enrollmentId" value={e.id} />
                  <button type="submit" name="decision" value="approve" className={buttonClass("primary", "sm")}>
                  อนุมัติ
                </button>
                  <button type="submit" name="decision" value="reject" className={buttonClass("danger", "sm")}>
                  ปฏิเสธ
                </button>
                </form>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </main>
  );
}
