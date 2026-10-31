import type { BadgeTone } from "@/components/ui";
import type { SetStatus } from "@/db/schema";

/** ชิ้นส่วนที่หน้าชุดการเรียนรู้ใช้ร่วมกัน */

export const STATUS: Record<SetStatus, { label: string; tone: BadgeTone }> = {
  draft: { label: "ร่าง", tone: "neutral" },
  pending_approval: { label: "รออนุมัติ", tone: "warning" },
  active: { label: "ใช้อยู่", tone: "success" },
  closed: { label: "ปิดแล้ว", tone: "neutral" },
};

export function Flash({ msg, err }: { msg?: string; err?: string }) {
  if (err) return <p className="mb-4 rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">{err}</p>;
  if (msg) return <p className="mb-4 rounded-lg bg-success-soft px-3 py-2 text-[13px] text-success">{msg}</p>;
  return null;
}
