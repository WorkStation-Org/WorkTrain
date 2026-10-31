import { redirect } from "next/navigation";
import { Button, Card, PageHeader } from "@/components/ui";
import { hasConsent } from "@/lib/identity-service";
import { pageActor } from "@/lib/page";
import { consentAction } from "../learn/actions";

export const dynamic = "force-dynamic";

/**
 * ความยินยอมให้สแกนใบหน้า (spec §8 · ADR-0006) — ไม่ยินยอม = ใช้ WorkTrain ไม่ได้
 *
 * ★ ข้อความนี้เป็นร่าง — ต้องให้ HR / ฝ่ายกฎหมายรับรองก่อนเปิดใช้ (spec §14) · แก้ข้อความ = เปลี่ยน `CONSENT_VERSION`
 */
export default async function ConsentPage() {
  const actor = await pageActor();
  if (await hasConsent(actor.personId)) redirect("/learn");
  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <PageHeader title="ความยินยอมให้สแกนใบหน้า" subtitle="ต้องยินยอมก่อนใช้ WorkTrain" />
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
          <p className="text-[12px] text-warning">ร่าง — รอ HR / ฝ่ายกฎหมายรับรองข้อความ</p>
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
