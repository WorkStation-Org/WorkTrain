"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, FIELD_LABEL_CLASS, SELECT_CLASS } from "@/components/ui";
import { DOCUMENT_KIND_LABELS, DOCUMENT_MIMES, formatBytesLimit, isDocumentMime, isVideoMime, kindAllowsMime, maxBytesFor } from "@/domain/document";
import { confirmUploadAction, requestUploadAction } from "../actions";

/**
 * อัปเอกสารต้นทาง — ขอลิงก์ → PUT ตรงเข้า R2 → ยืนยัน (set-service) · ไฟล์ไม่ผ่านเซิร์ฟเวอร์ของเรา
 * Content-Type ต้องตรงกับที่ขอลิงก์ไว้ เพราะลิงก์เซ็น Content-Type ด้วย
 * ★ ใช้ XMLHttpRequest แทน fetch เพื่อบอกความคืบหน้า — วิดีโอ 2 GB อัปนานหลายนาที (ADR-0013)
 */
export function UploadForm({ setId, allowPricelist }: { setId: number; allowPricelist: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const file = (form.elements.namedItem("file") as HTMLInputElement).files?.[0];
    const docKind = (form.elements.namedItem("docKind") as HTMLSelectElement).value;
    if (!file) return setError("เลือกไฟล์ก่อน");
    // ตรวจก่อนอัปให้รู้เร็ว — เซิร์ฟเวอร์ตรวจซ้ำอีกครั้งเสมอ
    if (!isDocumentMime(file.type)) return setError("รับเฉพาะ PDF · Excel (.xlsx) · วิดีโอ MP4");
    if (file.size > maxBytesFor(file.type)) {
      return setError(`${isVideoMime(file.type) ? "วิดีโอ" : "ไฟล์"}ต้องไม่เกิน ${formatBytesLimit(maxBytesFor(file.type))}`);
    }
    if (docKind === "pricelist" && !kindAllowsMime("pricelist", file.type)) return setError("Pricelist ต้องเป็น PDF หรือ Excel — วิดีโอแนบเป็นเอกสารหลักหรืออื่น ๆ");
    setBusy(true);
    setError(null);
    try {
      const req = await requestUploadAction({ setId, docKind, fileName: file.name, mime: file.type, size: file.size });
      if (!req.ok) return setError(req.error);
      setProgress(0);
      const status = await put(req.uploadUrl, file, setProgress);
      if (status < 200 || status >= 300) return setError(`อัปไฟล์ไม่สำเร็จ (${status || "เครือข่ายขาด"})`);
      const done = await confirmUploadAction({ setId, token: req.token });
      if (!done.ok) return setError(done.error);
      form.reset();
      router.refresh();
    } catch {
      setError("อัปไฟล์ไม่สำเร็จ ลองอีกครั้ง");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
      <label>
        <span className={FIELD_LABEL_CLASS}>ชนิด</span>
        <select name="docKind" className={SELECT_CLASS} defaultValue="catalog">
          <option value="catalog">{DOCUMENT_KIND_LABELS.catalog}</option>
          {allowPricelist && <option value="pricelist">{DOCUMENT_KIND_LABELS.pricelist}</option>}
          <option value="other">{DOCUMENT_KIND_LABELS.other}</option>
        </select>
      </label>
      <label className="min-w-60 flex-1">
        <span className={FIELD_LABEL_CLASS}>ไฟล์ (PDF หรือ Excel ไม่เกิน 30 MB · วิดีโอ MP4 ไม่เกิน 2 GB)</span>
        <input name="file" type="file" accept={Object.keys(DOCUMENT_MIMES).join(",")} className="block w-full text-[13px]" />
      </label>
      <Button type="submit" disabled={busy}>
        {busy ? (progress !== null && progress < 100 ? `กำลังอัป ${progress}%` : "กำลังตรวจไฟล์…") : "อัปโหลด"}
      </Button>
      {busy && progress !== null && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-subtle" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-primary transition-[width]" style={{ width: `${progress}%` }} />
        </div>
      )}
      <p className="w-full text-[12px] text-ink-3">วิดีโอใช้เป็นสื่อการเรียน — AI ออกข้อสอบจาก PDF ในชุดเดียวกัน จึงต้องมี PDF อย่างน้อย 1 ไฟล์</p>
      {error && <p className="w-full text-[13px] text-danger">{error}</p>}
    </form>
  );
}

/** PUT ไฟล์ตรงเข้าที่เก็บพร้อมรายงานเปอร์เซ็นต์ · คืน HTTP status (0 = เครือข่ายขาด) */
function put(url: string, file: File, onProgress: (percent: number) => void): Promise<number> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", file.type);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.floor((e.loaded / e.total) * 100));
    xhr.onload = () => resolve(xhr.status);
    xhr.onerror = () => resolve(0);
    xhr.send(file);
  });
}
