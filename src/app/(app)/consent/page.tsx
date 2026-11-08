import { redirect } from "next/navigation";
import { Button, Card, PageHeader } from "@/components/ui";
import { hasConsent } from "@/lib/identity-service";
import { pageActor } from "@/lib/page";
import { consentAction } from "../learn/actions";

export const dynamic = "force-dynamic";

/**
 * ความยินยอมให้สแกนใบหน้า (spec §8 · ADR-0006) — ไม่ยินยอม = ใช้ WorkTrain ไม่ได้
 *
 * ★ ข้อความนี้ HR / ฝ่ายกฎหมายตรวจรับรองแล้ว (8 พ.ย. 2569) — แก้ข้อความ = ต้องให้ตรวจใหม่ และเปลี่ยน `CONSENT_VERSION` (ทุกคนยินยอมใหม่)
 */
export default async function ConsentPage({ searchParams }: { searchParams: Promise<{ withdrawn?: string }> }) {
  const actor = await pageActor();
  if (await hasConsent(actor.personId)) redirect("/learn");
  const withdrawn = (await searchParams).withdrawn === "1";
  return (
    <main className="mx-auto w-full max-w-2xl">
      <PageHeader kicker="Privacy" title="ความยินยอมให้สแกนใบหน้า" subtitle="ต้องยินยอมก่อนใช้ WorkTrain" />
      {withdrawn && (
        <p className="mb-4 rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-ink-2">
          ถอนความยินยอมแล้ว — ลบภาพใบหน้าที่ลงทะเบียนแล้ว · ยินยอมใหม่ได้ทุกเมื่อ (ต้องลงทะเบียนใบหน้าใหม่และรอ TG อนุมัติ)
        </p>
      )}
      <Card>
        <div className="space-y-3 text-[14px] leading-relaxed text-ink-2">
          <p>WorkTrain ใช้การสแกนใบหน้าเพื่อยืนยันว่าคนที่เรียนและสอบคือเจ้าของบัญชีจริง</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>สแกนตอนเริ่มเรียนแต่ละรอบ และตอนเริ่มสอบทุกครั้ง</li>
            <li>ภาพใบหน้าถูกส่งไปตรวจที่ Amazon Web Services (AWS) ศูนย์ข้อมูลในประเทศไทย (ภาพไม่ถูกส่งออกนอกประเทศ) เพื่อยืนยันว่าเป็นคนจริงและตรงกับใบหน้าที่ลงทะเบียน</li>
            <li>ภาพจากการสแกนเก็บ 90 วันแล้วลบ · ภาพลงทะเบียนเก็บจนกว่าจะพ้นสภาพหรือถอนความยินยอม</li>
            <li>ผู้ที่เห็นภาพได้คือทีม TG เมื่อการสแกนไม่ผ่านและต้องตรวจด้วยตา</li>
            <li>ถอนความยินยอมได้ แต่จะใช้ WorkTrain ไม่ได้จนกว่าจะยินยอมใหม่</li>
          </ul>
        </div>
        <form action={consentAction} className="mt-5">
          <Button type="submit" variant="primary">
            ยินยอม
          </Button>
        </form>
      </Card>
    </main>
  );
}
