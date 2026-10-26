import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { enrollmentState, scanMode } from "@/lib/identity-service";
import { learnerActor } from "@/lib/page";
import { ScanFlow } from "../learn/scan-flow";

export const dynamic = "force-dynamic";

/**
 * ลงทะเบียนใบหน้า (spec §8) — ครั้งแรกใช้ได้ทันที · ลงทะเบียนใหม่ต้องให้ TG อนุมัติ (กันการลงทะเบียนหน้าคนอื่นแทน)
 */
export default async function EnrollPage() {
  const actor = await learnerActor();
  const state = await enrollmentState(actor.personId);
  const mode = scanMode();
  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <PageHeader
        title="ลงทะเบียนใบหน้า"
        subtitle="ใช้เทียบตอนเริ่มเรียนและเริ่มสอบ"
        actions={<Link href="/learn" className="text-[13px] text-ink-3 underline">ชุดที่ต้องเรียน</Link>}
      />
      <Card>
        {state.state === "none" && (
          <>
            <p className="mb-3 text-[13px] text-ink-2">หน้าตรง แสงพอ ไม่สวมแมสก์หรือแว่นกันแดด แล้วขยับหน้าตามที่จอบอก</p>
            <ScanFlow mode={mode} purpose="enroll" label="สแกนเพื่อลงทะเบียน" />
          </>
        )}
        {state.state === "active" && !state.pending && (
          <>
            <p className="mb-3 text-[13px] text-success">ลงทะเบียนใบหน้าแล้ว</p>
            <p className="mb-3 text-[13px] text-ink-3">สแกนไม่ผ่านบ่อย (เช่น เปลี่ยนทรงผม ใส่แว่น) ขอลงทะเบียนใหม่ได้ — TG ต้องอนุมัติก่อนใช้</p>
            <ScanFlow mode={mode} purpose="enroll" label="ขอลงทะเบียนใบหน้าใหม่" />
          </>
        )}
        {(state.state === "pending_only" || (state.state === "active" && state.pending)) && (
          <p className="text-[13px] text-warning">มีคำขอลงทะเบียนใบหน้าใหม่ที่รอ TG อนุมัติ</p>
        )}
      </Card>
    </main>
  );
}
