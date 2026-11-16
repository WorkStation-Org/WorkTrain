"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { previewLinkAction } from "../actions";

/**
 * เปิดดูเอกสารในแท็บเอกสาร — ผู้สร้าง · ผู้อนุมัติ · TG ตรวจเนื้อหาก่อนอนุมัติ
 *
 * ★ ขอลิงก์ตอนกดเท่านั้น (ลิงก์อายุสั้น · ไม่โหลดวิดีโอทุกไฟล์ตอนเปิดหน้า) · ไม่นับเป็นการเรียน
 * ★ PDF วาดด้วย pdfjs ตัวเดียวกับฝั่งผู้เรียน (≥ 6.2.108) · Pricelist ได้ไฟล์ที่ประทับลายน้ำของคนเปิดจากเซิร์ฟเวอร์
 */

/** เล่นวิดีโอในกรอบปก */
export function VideoPreview({ documentId, fileName }: { documentId: number; fileName: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function play() {
    setBusy(true);
    setError(null);
    const link = await previewLinkAction({ documentId }).catch(() => null);
    setBusy(false);
    if (!link?.ok) return setError(link?.error ?? "เปิดวิดีโอไม่ได้ ลองใหม่");
    setUrl(link.url);
  }

  if (url) {
    return (
      <video
        src={url}
        controls
        autoPlay
        playsInline
        className="absolute inset-0 size-full bg-black"
        // ลิงก์อายุ 10 นาที — หยุดไว้นานแล้วเลื่อนต่อจะโหลดไม่ได้ กดเล่นใหม่ = ขอลิงก์ใหม่
        onError={() => {
          setUrl(null);
          setError("เล่นวิดีโอไม่ได้ — กดเล่นอีกครั้ง");
        }}
      />
    );
  }
  return (
    <button type="button" onClick={play} disabled={busy} aria-label={`เล่น ${fileName}`} className="group absolute inset-0 flex flex-col items-center justify-center gap-2">
      <span className="flex size-14 items-center justify-center rounded-full bg-black/60 text-white transition group-hover:bg-black/75">
        <svg viewBox="0 0 16 16" width={20} height={20} aria-hidden fill="currentColor">
          <path d="M5 3.5v9l7.5-4.5z" />
        </svg>
      </span>
      {busy && <span className="rounded bg-black/60 px-2 py-0.5 text-[12px] text-white">กำลังเปิด…</span>}
      {error && <span className="rounded bg-black/70 px-2 py-0.5 text-[12px] text-white">{error}</span>}
    </button>
  );
}

/** ปุ่มเปิดอ่าน PDF ในหน้าต่างใหญ่ — แผงด้านขวาแคบเกินจะอ่านแคตตาล็อก */
export function PdfPreview({ documentId, fileName, confidential }: { documentId: number; fileName: string; confidential: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        size="sm"
        onClick={() => {
          setOpen(true);
          dialog.current?.showModal();
        }}
      >
        เปิดอ่าน PDF
      </Button>
      <dialog
        ref={dialog}
        onClose={() => setOpen(false)}
        aria-label={fileName}
        className="m-auto h-[90dvh] w-[min(960px,calc(100vw-32px))] max-w-none rounded-[13px] border border-line bg-raised p-0 text-fg backdrop:bg-black/60"
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center gap-2 border-b border-line px-4 py-3">
            <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{fileName}</span>
            <Button type="button" size="sm" variant="ghost" onClick={() => dialog.current?.close()}>
              ปิด
            </Button>
          </div>
          {confidential && <p className="border-b border-line px-4 py-2 text-[12px] text-danger">Pricelist — ทุกหน้ามีอีเมลของคุณและเวลาที่เปิด · ระบบบันทึกการเปิดทุกครั้ง</p>}
          <div className="min-h-0 flex-1 overflow-y-auto p-4" onContextMenu={confidential ? (e) => e.preventDefault() : undefined}>
            {open && <PdfPages documentId={documentId} />}
          </div>
        </div>
      </dialog>
    </>
  );
}

function PdfPages({ documentId }: { documentId: number }) {
  const container = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ loading: boolean; error: string | null }>({ loading: true, error: null });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const link = await previewLinkAction({ documentId });
      if (!link.ok) return setState({ loading: false, error: link.error });
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
      const pdf = await pdfjs.getDocument({ url: link.url }).promise;
      if (cancelled) return;
      container.current?.replaceChildren();
      for (let n = 1; n <= pdf.numPages && !cancelled; n++) {
        const page = await pdf.getPage(n);
        if (cancelled) return;
        // ★ `||` ไม่ใช่ `??` — ก่อน layout เสร็จ clientWidth เป็น 0
        const width = container.current?.clientWidth || 800;
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: (width / base.width) * (window.devicePixelRatio || 1) });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = "100%";
        canvas.className = "mb-3 rounded border border-line";
        container.current?.appendChild(canvas);
        await page.render({ canvas, viewport }).promise;
        if (n === 1) setState({ loading: false, error: null });
      }
    })().catch(() => !cancelled && setState({ loading: false, error: "เปิดเอกสารไม่ได้ ลองปิดแล้วเปิดใหม่" }));
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  return (
    <>
      {state.loading && <p className="text-[13px] text-muted">กำลังเปิด…</p>}
      {state.error && <p className="text-[13px] text-danger">{state.error}</p>}
      <div ref={container} />
    </>
  );
}
