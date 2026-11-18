"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, SELECT_CLASS } from "@/components/ui";
import type { ClipTarget } from "@/lib/clip-transfer";
import { transferClipAction } from "../actions";

/**
 * ย้าย/คัดลอกคลิปไปชุดอื่น — TG เท่านั้น (ADR-0022) · อยู่ในแผงรายละเอียดของคลิปที่เลือกในขั้นเอกสาร
 * บอกผลกับผู้เรียนของทั้งสองชุดก่อนกด · เซิร์ฟเวอร์ตัดสินอีกครั้ง (`transferClip`)
 */

export interface ClipTransferOptions {
  targets: ClipTarget[];
  /** ย้ายออกจากชุดนี้แล้วชุดนี้เป็นอย่างไร · null = ชุดปิดแล้ว คัดลอกได้อย่างเดียว */
  moveOut: "remove" | "hide" | null;
}

export interface TransferNotice {
  ok: boolean;
  text: string;
  href?: string;
}

function landingNote(t: ClipTarget): string {
  if (t.landing === "draft") return "ชุดปลายทางยังเป็นร่าง — คลิปต่อท้ายรายการ ไม่กระทบผู้เรียน";
  if (t.landing === "new_version") return "ชุดปลายทางกำลังทำเวอร์ชันใหม่ — คลิปเข้าเวอร์ชันใหม่ ผู้เรียนเห็นเมื่ออนุมัติ";
  return t.learnersToWatch > 0
    ? `ชุดปลายทางใช้อยู่ — คลิปขึ้นให้ผู้เรียนทันทีเป็นตอนสุดท้าย · ผู้เรียนที่ยังไม่ผ่าน ${t.learnersToWatch} คนต้องดูคลิปนี้ก่อนสอบ · คนที่ผ่านแล้วไม่ต้องทำอะไร`
    : "ชุดปลายทางใช้อยู่ — คลิปขึ้นให้ผู้เรียนทันทีเป็นตอนสุดท้าย · ตอนนี้ไม่มีผู้เรียนที่ยังไม่ผ่าน";
}

const MOVE_OUT_NOTE = {
  remove: "ชุดนี้: เอาคลิปออก (ยังไม่มีใครเรียน)",
  hide: "ชุดนี้: ซ่อนคลิป — ผู้เรียนที่ยังไม่ผ่านไม่ต้องดูแล้ว · คนที่ผ่านแล้วทบทวนคลิปนี้ในชุดนี้ไม่ได้ · ความคืบหน้าและประวัติยังอยู่",
} as const;

export function ClipTransfer({
  setId,
  documentId,
  fileName,
  options,
  onDone,
}: {
  setId: number;
  documentId: number;
  fileName: string;
  options: ClipTransferOptions;
  onDone: (notice: TransferNotice) => void;
}) {
  const router = useRouter();
  const [targetId, setTargetId] = useState<number | null>(null);
  const [mode, setMode] = useState<"copy" | "move">("copy");
  const [busy, setBusy] = useState(false);
  // ไม่สำเร็จ = บอกในแผงนี้ (คนกดมองอยู่ตรงนี้) · สำเร็จ = บอกที่รายการ เพราะคลิปที่ย้ายออกอาจหายจากรายการพร้อมแผงนี้
  const [error, setError] = useState<string | null>(null);
  const target = options.targets.find((t) => t.setId === targetId) ?? null;
  const active = options.targets.filter((t) => t.status === "active");
  const drafts = options.targets.filter((t) => t.status === "draft");
  const verb = mode === "move" ? "ย้าย" : "คัดลอก";

  async function run() {
    if (!target) return;
    const lines = [`${verb} "${fileName}" ไปชุด "${target.title}"?`, landingNote(target)];
    if (mode === "move" && options.moveOut) lines.push(MOVE_OUT_NOTE[options.moveOut]);
    if (!confirm(lines.join("\n\n"))) return;
    setBusy(true);
    setError(null);
    const out = await transferClipAction({ setId, documentId, targetSetId: target.setId, mode }).catch(() => ({ ok: false as const, error: "ส่งคลิปไม่สำเร็จ ลองอีกครั้ง" }));
    setBusy(false);
    if (!out.ok) return setError(out.error);
    const after = out.source === "hidden" ? " · ซ่อนในชุดนี้แล้ว" : out.source === "removed" ? " · เอาออกจากชุดนี้แล้ว" : "";
    onDone({ ok: true, text: `✓ ${verb} "${fileName}" ไปชุด "${target.title}" แล้ว${after}`, href: `/sets/${target.setId}?tab=docs` });
    setTargetId(null);
    router.refresh();
  }

  return (
    <div className="space-y-2 border-t border-line pt-4">
      <span className="block text-[12px] text-ink-2">ย้าย/คัดลอกไปชุดอื่น (TG)</span>
      {options.targets.length === 0 ? (
        <p className="text-[12px] text-muted">ยังไม่มีชุดอื่นที่รับคลิปได้ — รับได้เฉพาะชุดร่างและชุดที่ใช้อยู่ (ไม่ได้รออนุมัติ)</p>
      ) : (
        <>
          <label className="block">
            <span className="sr-only">ชุดปลายทาง</span>
            <select
              value={targetId ?? ""}
              onChange={(e) => {
                setTargetId(e.target.value ? Number(e.target.value) : null);
                setError(null);
              }}
              className={SELECT_CLASS}
            >
              <option value="">เลือกชุดปลายทาง</option>
              {active.length > 0 && (
                <optgroup label="ใช้อยู่">
                  {active.map((t) => (
                    <option key={t.setId} value={t.setId}>
                      {t.title}
                      {t.landing === "new_version" ? " (เวอร์ชันใหม่)" : ""}
                    </option>
                  ))}
                </optgroup>
              )}
              {drafts.length > 0 && (
                <optgroup label="ร่าง">
                  {drafts.map((t) => (
                    <option key={t.setId} value={t.setId}>
                      {t.title}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
          <fieldset className="flex gap-1 rounded-[10px] bg-subtle p-1">
            <legend className="sr-only">ย้ายหรือคัดลอก</legend>
            {(["copy", "move"] as const).map((m) => {
              const disabled = m === "move" && options.moveOut === null;
              return (
                <label
                  key={m}
                  className={`flex min-h-9 flex-1 cursor-pointer items-center justify-center rounded-lg px-2 text-[13px] has-[:disabled]:cursor-not-allowed has-[:disabled]:text-ink-4 ${mode === m ? "bg-raised font-semibold text-fg shadow-sm" : "text-ink-2"}`}
                >
                  <input
                    type="radio"
                    name={`transfer-${documentId}`}
                    value={m}
                    checked={mode === m}
                    disabled={disabled}
                    onChange={() => {
                      setMode(m);
                      setError(null);
                    }}
                    className="sr-only"
                  />
                  {m === "copy" ? "คัดลอก" : "ย้าย"}
                </label>
              );
            })}
          </fieldset>
          <ul className="space-y-1 text-[12px] leading-relaxed text-muted">
            <li>{mode === "copy" ? "ชุดนี้: คลิปเดิมอยู่ที่เดิม" : options.moveOut ? MOVE_OUT_NOTE[options.moveOut] : "ชุดนี้ปิดแล้ว — คัดลอกได้อย่างเดียว"}</li>
            {target && <li className={target.landing === "live" && target.learnersToWatch > 0 ? "text-warn" : ""}>{landingNote(target)}</li>}
            <li>ไปพร้อมชื่อ · ความยาว · ปก — ไฟล์ถูกคัดลอกเป็นของชุดปลายทาง</li>
          </ul>
          <Button type="button" size="sm" variant="secondary" onClick={() => void run()} disabled={!target || busy}>
            {busy ? `กำลัง${verb}…` : `${verb}ไปชุดนี้`}
          </Button>
          {error && (
            <p role="alert" className="text-[12px] text-danger">
              {error}
            </p>
          )}
        </>
      )}
    </div>
  );
}
