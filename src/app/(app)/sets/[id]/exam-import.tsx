"use client";

import { useRef, useState } from "react";
import { Button, buttonClass } from "@/components/ui";
import { MAX_EXAM_SHEET_BYTES } from "@/domain/document";
import type { ImportOutcome } from "@/lib/exam-service";
import { importExamsAction } from "../actions";

/**
 * ปุ่ม Template + Import ข้อสอบ (ADR-0015) — วางในแถว flex-wrap ข้างปุ่มให้ AI ออก
 * ผลแสดงอยู่ที่เดิมเต็มแถว (`basis-full`) · ไม่ผ่านบอกทุกจุดตามเลขแถวใน Excel · ข้อสอบเดิมไม่ถูกแตะ
 */
export function ExamImport({ setId, kind, hasExisting }: { setId: number; kind: "full" | "delta"; hasExisting: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportOutcome | null>(null);
  const what = kind === "delta" ? "ข้อสอบส่วนที่เปลี่ยนทั้ง 5 ชุด" : "ข้อสอบทั้ง 5 ชุด";

  function pick() {
    if (hasExisting && !confirm(`Import จะแทน${what}ด้วยไฟล์ที่เลือก และเครื่องหมาย "ตรวจแล้ว" จะหายหมด\n\nถ้าไฟล์ไม่ผ่าน ข้อสอบเดิมยังอยู่ครบ`)) return;
    input.current?.click();
  }

  async function upload(file: File) {
    setResult(null);
    if (file.size > MAX_EXAM_SHEET_BYTES) return setResult({ ok: false, error: "ไฟล์ใหญ่เกิน 900 KB — Template ข้อสอบไม่ควรใหญ่ขนาดนี้ ลองโหลด Template ใหม่" });
    const form = new FormData();
    form.set("setId", String(setId));
    form.set("kind", kind);
    form.set("file", file);
    setBusy(true);
    const out = await importExamsAction(form).catch(() => ({ ok: false as const, error: "Import ไม่สำเร็จ — ลองอีกครั้ง" }));
    setBusy(false);
    setResult(out);
  }

  return (
    <>
      <a href={`/sets/${setId}/exam-template${kind === "delta" ? "?kind=delta" : ""}`} download className={buttonClass("secondary")} title="โหลดไฟล์ Excel ไปกรอกข้อสอบเอง">
        Template
      </a>
      <Button onClick={pick} disabled={busy} title="นำข้อสอบจาก Template ที่กรอกแล้วเข้าระบบ">
        {busy ? "กำลัง Import…" : "Import"}
      </Button>
      <input
        ref={input}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void upload(file);
        }}
      />
      {result && (
        <div role="status" className="basis-full">
          {result.ok ? (
            <p className="rounded-[13px] border border-success/30 bg-success-soft px-4 py-2.5 text-[13px] font-semibold text-success">
              ✓ Import แล้ว {result.count} ข้อ — ตรวจทุกข้อก่อน{kind === "delta" ? "อนุมัติ" : "ส่งขออนุมัติ"}
            </p>
          ) : (
            <div className="rounded-[13px] border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] text-danger">
              <p className="font-semibold">{result.error}</p>
              {result.rows && (
                <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto">
                  {result.rows.map((r, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="w-16 shrink-0 font-semibold">{r.row ? `แถว ${r.row}` : "ทั้งไฟล์"}</span>
                      <span className="text-ink-2">{r.message}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
