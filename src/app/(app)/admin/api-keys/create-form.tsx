"use client";

import { useActionState, useState } from "react";
import { Alert, Button, FIELD_HINT_CLASS, FIELD_LABEL_CLASS, INPUT_CLASS } from "@/components/ui";
import { createApiKeyAction, type CreateKeyState } from "./actions";

/**
 * ออก key ใหม่ — key เต็มแสดงในกล่องนี้ครั้งเดียว · ออกจากหน้าหรือรีเฟรชแล้วดูไม่ได้อีก (ฐานเก็บแค่ hash)
 * ไม่ import ของฝั่งเซิร์ฟเวอร์ — ค่าคงที่ส่งเข้ามาทาง props
 */
export function CreateKeyForm({ noteMax }: { noteMax: number }) {
  const [state, action, pending] = useActionState<CreateKeyState, FormData>(createApiKeyAction, null);
  const [copied, setCopied] = useState(false);

  async function copy(key: string) {
    try {
      await navigator.clipboard.writeText(key);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="space-y-4">
      {state?.ok && (
        <Alert kind="success" title={`key ของ ${state.name} — คัดลอกตอนนี้ แสดงครั้งเดียว`}>
          <p className="mb-2">ส่งให้ทีมของระบบปลายทางทางช่องที่เป็นส่วนตัว ห้ามแปะในกลุ่มแชตหรือในโค้ด · WorkTrain ไม่เก็บ key เต็ม ถ้าหายต้องออกใหม่</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 rounded-lg border border-line bg-canvas px-3 py-2 font-mono text-xs break-all text-fg">{state.key}</code>
            <Button size="sm" icon={copied ? "check" : "copy"} onClick={() => copy(state.key)}>
              {copied ? "คัดลอกแล้ว" : "คัดลอก"}
            </Button>
          </div>
        </Alert>
      )}
      {state && !state.ok && <Alert kind="error">{state.error}</Alert>}

      <form action={action} onSubmit={() => setCopied(false)} className="grid gap-4 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto] sm:items-end">
        <label className="block">
          <span className={FIELD_LABEL_CLASS}>ระบบที่ใช้</span>
          <input name="name" required pattern="[a-z][a-z0-9\-]{1,39}" placeholder="เช่น workhr" autoComplete="off" className={INPUT_CLASS} />
        </label>
        <label className="block">
          <span className={FIELD_LABEL_CLASS}>หมายเหตุ (ไม่บังคับ)</span>
          <input name="note" maxLength={noteMax} placeholder="เช่น ดึงสถานะ Onboarding ให้ WorkHR" className={INPUT_CLASS} />
        </label>
        <Button type="submit" variant="primary" icon="key" disabled={pending}>
          {pending ? "กำลังออก…" : "ออก key"}
        </Button>
      </form>
      <span className={FIELD_HINT_CLASS}>ชื่อระบบเป็นอังกฤษตัวเล็ก · ชื่อเดียวกันออกได้หลาย key ใช้ตอนเปลี่ยน key: ออกใหม่ → ให้ปลายทางเปลี่ยน → ถอนตัวเก่า</span>
    </div>
  );
}
