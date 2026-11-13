"use client";

import { buttonClass } from "@/components/ui";
import { closeSetAction, deleteSetAction } from "./actions";

/**
 * ลบร่าง / ปิดชุดที่ใช้อยู่ (ADR-0016) — ถามยืนยันก่อนเสมอ เพราะย้อนกลับไม่ได้
 * ใช้ทั้งในรายการชุดและหัวหน้าชุด
 */
export function EndSetButton({ setId, title, mode, tab }: { setId: number; title: string; mode: "delete" | "close"; tab?: string }) {
  const ask =
    mode === "delete"
      ? `ลบร่าง "${title}"?\n\nชุดจะหายจากรายการ และกู้คืนไม่ได้`
      : `ปิดชุด "${title}"?\n\nผู้เรียนจะไม่เห็นชุดนี้อีก · ไม่มอบให้คนใหม่ · ไม่เตือน\nผลที่สอบไปแล้วยังอยู่ในสถิติ · เปิดกลับไม่ได้`;
  return (
    <form action={mode === "delete" ? deleteSetAction : closeSetAction} onSubmit={(e) => !confirm(ask) && e.preventDefault()}>
      <input type="hidden" name="setId" value={setId} />
      {tab && <input type="hidden" name="tab" value={tab} />}
      <button type="submit" className={buttonClass("danger-ghost", "sm")}>
        {mode === "delete" ? "ลบร่าง" : "ปิดชุด"}
      </button>
    </form>
  );
}
