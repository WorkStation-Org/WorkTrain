"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, FIELD_LABEL_CLASS, SELECT_CLASS } from "@/components/ui";
import { confirmUploadAction, requestUploadAction } from "../actions";

/**
 * อัปเอกสารต้นทาง — ขอลิงก์ → PUT ตรงเข้า R2 → ยืนยัน (set-service) · ไฟล์ไม่ผ่านเซิร์ฟเวอร์ของเรา
 * Content-Type ต้องตรงกับที่ขอลิงก์ไว้ เพราะลิงก์เซ็น Content-Type ด้วย
 */
export function UploadForm({ setId, allowPricelist }: { setId: number; allowPricelist: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const file = (form.elements.namedItem("file") as HTMLInputElement).files?.[0];
    const docKind = (form.elements.namedItem("docKind") as HTMLSelectElement).value;
    if (!file) return setError("เลือกไฟล์ก่อน");
    setBusy(true);
    setError(null);
    try {
      const req = await requestUploadAction({ setId, docKind, fileName: file.name, mime: file.type, size: file.size });
      if (!req.ok) return setError(req.error);
      const put = await fetch(req.uploadUrl, { method: "PUT", body: file, headers: { "content-type": file.type } });
      if (!put.ok) return setError(`อัปไฟล์ไม่สำเร็จ (${put.status})`);
      const done = await confirmUploadAction({ setId, token: req.token });
      if (!done.ok) return setError(done.error);
      form.reset();
      router.refresh();
    } catch {
      setError("อัปไฟล์ไม่สำเร็จ ลองอีกครั้ง");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
      <label>
        <span className={FIELD_LABEL_CLASS}>ชนิด</span>
        <select name="docKind" className={SELECT_CLASS} defaultValue="catalog">
          <option value="catalog">แคตตาล็อก</option>
          {allowPricelist && <option value="pricelist">Pricelist</option>}
          <option value="other">อื่น ๆ</option>
        </select>
      </label>
      <label className="min-w-60 flex-1">
        <span className={FIELD_LABEL_CLASS}>ไฟล์ (PDF หรือ Excel · ไม่เกิน 30 MB)</span>
        <input
          name="file"
          type="file"
          accept="application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="block w-full text-[13px]"
        />
      </label>
      <Button type="submit" disabled={busy}>
        {busy ? "กำลังอัป…" : "อัปโหลด"}
      </Button>
      {error && <p className="w-full text-[13px] text-danger">{error}</p>}
    </form>
  );
}
