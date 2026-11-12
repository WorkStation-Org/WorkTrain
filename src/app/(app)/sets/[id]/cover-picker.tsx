"use client";

import { useRouter } from "next/navigation";
import { type Ref, useImperativeHandle, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { COVER_WIDTH, formatDuration, MAX_COVER_BYTES } from "@/domain/document";
import { authorVideoLinkAction, setCoverAction } from "../actions";

/**
 * เลือกปกวิดีโอจากเฟรมในคลิป (ADR-0013) — เลื่อนแถบเวลาแล้วเห็นเฟรมนั้นทันที · จับเฟรมเป็น JPEG ในเบราว์เซอร์
 *
 * ★ ไฟล์ในเครื่อง (ตอนอัป) จับเฟรมได้เสมอ · ไฟล์ที่อยู่บน R2 แล้วต้องโหลดแบบ `crossOrigin` — bucket ต้องตั้ง CORS
 *   ให้รับ GET จากโดเมนของ WorkTrain ไม่งั้นเบราว์เซอร์ห้ามอ่านภาพจาก canvas (SecurityError)
 */

export interface CoverPickerHandle {
  capture(): Promise<{ blob: Blob; ms: number }>;
}

const CORS_HINT = "จับภาพจากวิดีโอที่อยู่บน R2 ไม่ได้ — ต้องตั้ง CORS ของ bucket ให้รับ GET จากโดเมน WorkTrain (หรือเลือกปกตอนอัปวิดีโอ)";

export function CoverPicker({ src, remote = false, initialMs, ref }: { src: string; remote?: boolean; initialMs?: number | null; ref?: Ref<CoverPickerHandle> }) {
  const video = useRef<HTMLVideoElement>(null);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [error, setError] = useState<string | null>(null);

  function seek(t: number) {
    const v = video.current;
    if (!v) return;
    setTime(t);
    v.currentTime = t;
  }

  function onLoadedMetadata() {
    const v = video.current;
    if (!v) return;
    setDuration(v.duration);
    // ตั้งต้นที่ 10% ของคลิป — เฟรมแรกมักเป็นจอดำหรือโลโก้
    seek(initialMs != null ? Math.min(initialMs / 1000, v.duration) : v.duration * 0.1);
  }

  useImperativeHandle(ref, () => ({
    async capture() {
      const v = video.current;
      if (!v || !v.videoWidth) throw new Error("วิดีโอยังโหลดไม่เสร็จ");
      if (v.seeking) await new Promise((r) => v.addEventListener("seeked", r, { once: true }));
      const scale = Math.min(1, COVER_WIDTH / v.videoWidth);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(v.videoWidth * scale);
      canvas.height = Math.round(v.videoHeight * scale);
      canvas.getContext("2d")!.drawImage(v, 0, 0, canvas.width, canvas.height);
      let blob: Blob | null;
      try {
        blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.82));
      } catch {
        throw new Error(CORS_HINT);
      }
      if (!blob) throw new Error("จับภาพไม่สำเร็จ ลองเลือกเฟรมใหม่");
      if (blob.size > MAX_COVER_BYTES) blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.6));
      if (!blob) throw new Error("จับภาพไม่สำเร็จ ลองเลือกเฟรมใหม่");
      return { blob, ms: Math.round(v.currentTime * 1000) };
    },
  }));

  return (
    <div className="space-y-2">
      <video
        ref={video}
        src={src}
        crossOrigin={remote ? "anonymous" : undefined}
        muted
        playsInline
        preload="auto"
        onLoadedMetadata={onLoadedMetadata}
        onError={() => setError(remote ? CORS_HINT : "เปิดวิดีโอนี้ในเบราว์เซอร์ไม่ได้ — ต้องเป็น MP4 H.264")}
        className="block aspect-video w-full rounded-lg bg-black object-contain"
      />
      <label className="flex items-center gap-3 text-[12px] text-muted">
        <span className="shrink-0">เฟรมปก</span>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={time}
          disabled={!duration}
          onChange={(e) => seek(Number(e.target.value))}
          className="min-w-0 flex-1 accent-[var(--color-fg)]"
          aria-label="เลื่อนเลือกเฟรมที่จะใช้เป็นปก"
        />
        <span className="w-24 shrink-0 text-right tabular-nums text-ink-2">
          {formatDuration(time)} / {formatDuration(duration)}
        </span>
      </label>
      {error && <p className="text-[12px] text-danger">{error}</p>}
    </div>
  );
}

/** ปกของวิดีโอที่อัปไว้แล้ว — ภาพปกปัจจุบัน + ปุ่มเปลี่ยน (เปิดตัวเลือกเฟรมจากไฟล์บน R2) */
export function CoverEditor({
  setId,
  documentId,
  coverUrl,
  coverMs,
  canEdit,
}: {
  setId: number;
  documentId: number;
  coverUrl: string | null;
  coverMs: number | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const picker = useRef<CoverPickerHandle>(null);
  const [src, setSrc] = useState<{ url: string; remote: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** ทางเลือกเมื่อโหลดวิดีโอจาก R2 ไม่ได้ (CORS) — เลือกไฟล์เดิมจากเครื่องแล้วจับเฟรมจากไฟล์นั้น */
  function pickLocal(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.currentTarget.files?.[0];
    if (!file) return;
    setError(null);
    setSrc({ url: URL.createObjectURL(file), remote: false });
  }

  async function open() {
    setBusy(true);
    setError(null);
    const out = await authorVideoLinkAction({ documentId }).catch(() => null);
    setBusy(false);
    if (!out?.ok) return setError(out?.error ?? "เปิดวิดีโอไม่ได้");
    setSrc({ url: out.url, remote: true });
  }

  async function save() {
    if (!picker.current) return;
    setBusy(true);
    setError(null);
    try {
      const { blob, ms } = await picker.current.capture();
      const out = await saveCover(setId, documentId, blob, ms);
      if (!out.ok) return setError(out.error);
      setSrc(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "บันทึกปกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-full space-y-2">
      {!src && (
        <div className="flex flex-wrap items-center gap-3">
          {coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- ภาพผ่าน route ที่ตรวจสิทธิ์ ไม่ผ่าน next/image
            <img src={coverUrl} alt="ปกวิดีโอ" className="aspect-video w-28 rounded-md object-cover" />
          ) : (
            <span className="flex aspect-video w-28 items-center justify-center rounded-md bg-[#2c2e32] text-[11px] text-[#c9cbcf]">ยังไม่มีปก</span>
          )}
          {canEdit && (
            <Button type="button" size="sm" onClick={open} disabled={busy}>
              {busy ? "กำลังเปิด…" : coverUrl ? "เปลี่ยนปก" : "เลือกปกจากคลิป"}
            </Button>
          )}
          {canEdit && (
            <label className="cursor-pointer text-[12px] text-muted underline">
              หรือเลือกไฟล์วิดีโอเดิมจากเครื่อง
              <input type="file" accept="video/mp4" onChange={pickLocal} className="sr-only" />
            </label>
          )}
        </div>
      )}
      {src && (
        <div className="space-y-2 rounded-lg border border-line bg-canvas p-3">
          <CoverPicker ref={picker} src={src.url} remote={src.remote} initialMs={coverMs} />
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="primary" onClick={save} disabled={busy}>
              {busy ? "กำลังบันทึก…" : "ใช้เฟรมนี้เป็นปก"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setSrc(null)} disabled={busy}>
              ยกเลิก
            </Button>
          </div>
        </div>
      )}
      {error && <p className="text-[12px] text-danger">{error}</p>}
    </div>
  );
}

/**
 * ปกอัตโนมัติจากไฟล์ในเครื่อง — จับเฟรมที่ 10% ของคลิป (เฟรมแรกมักเป็นจอดำ) ใช้ตอนอัปหลายไฟล์พร้อมกัน
 * ไฟล์ในเครื่องจับเฟรมได้เสมอ ไม่ต้องพึ่ง CORS ของ R2 · เปิดไม่ได้ = null (อัปต่อได้ แค่ไม่มีปก)
 */
export async function captureCoverFromFile(file: File, fraction = 0.1): Promise<{ blob: Blob; ms: number } | null> {
  const url = URL.createObjectURL(file);
  const v = document.createElement("video");
  v.muted = true;
  v.playsInline = true;
  v.preload = "auto";
  v.src = url;
  try {
    await new Promise<void>((ok, fail) => {
      v.onloadedmetadata = () => ok();
      v.onerror = () => fail(new Error("load"));
    });
    const t = Math.max(0, Math.min(v.duration * fraction, v.duration - 0.1));
    await new Promise<void>((ok, fail) => {
      v.onseeked = () => ok();
      v.onerror = () => fail(new Error("seek"));
      v.currentTime = t;
    });
    const scale = Math.min(1, COVER_WIDTH / v.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(v.videoWidth * scale);
    canvas.height = Math.round(v.videoHeight * scale);
    canvas.getContext("2d")!.drawImage(v, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.82));
    return blob && blob.size <= MAX_COVER_BYTES ? { blob, ms: Math.round(t * 1000) } : null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** ส่งปกเข้า server action (ภาพเล็ก ≤ 512 KB จึงส่งผ่าน action ได้ ไม่ต้องขอลิงก์อัป) */
export function saveCover(setId: number, documentId: number, blob: Blob, ms: number) {
  const form = new FormData();
  form.set("setId", String(setId));
  form.set("documentId", String(documentId));
  form.set("ms", String(ms));
  form.set("cover", blob, "cover.jpg");
  return setCoverAction(form);
}
