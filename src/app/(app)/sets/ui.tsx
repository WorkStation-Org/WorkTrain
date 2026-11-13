import { Alert, type BadgeTone } from "@/components/ui";
import type { SetStatus } from "@/db/schema";

/** ชิ้นส่วนที่หน้าชุดการเรียนรู้ใช้ร่วมกัน */

export const STATUS: Record<SetStatus, { label: string; tone: BadgeTone }> = {
  draft: { label: "ร่าง", tone: "neutral" },
  pending_approval: { label: "รออนุมัติ", tone: "warning" },
  active: { label: "ใช้อยู่", tone: "success" },
  closed: { label: "ปิดแล้ว", tone: "neutral" },
  deleted: { label: "ลบแล้ว", tone: "neutral" },
};

export function Flash({ msg, err }: { msg?: string; err?: string }) {
  if (err) return <Alert className="mb-5">{err}</Alert>;
  if (msg) return <Alert kind="success" className="mb-5">{msg}</Alert>;
  return null;
}
