"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { documentLinkAction, readingBeatAction } from "../actions";

/**
 * ตัวอ่านเอกสาร (spec §9) — แสดง PDF ทีละหน้า · นับหน้าที่เลื่อนผ่าน · นับเวลาเฉพาะตอนแท็บอยู่หน้าและมีการขยับ
 *
 * ★ เบราว์เซอร์แค่รายงาน — เซิร์ฟเวอร์เป็นคนตัดสินว่าอ่านครบไหม (จำนวนหน้าจากไฟล์จริง · จำกัดเวลาต่อครั้ง)
 * ★ เซิร์ฟเวอร์ตอบ `session_ended` (นิ่งเกิน 2 นาที) = รีเฟรชหน้า → ปุ่มสแกนเพื่อเรียนต่อ
 * ★ pdfjs ≥ 6.2.108 เท่านั้น (GHSA-hq66-cqwq-w95j: รัน JavaScript จาก PDF ที่ประสงค์ร้ายได้) — ไฟล์มาจากผู้สร้างในบริษัท แต่ไม่ไว้ใจเนื้อไฟล์
 */

const BEAT_MS = 15_000;
/** ขยับล่าสุดภายในเวลานี้ = ยังนับว่ากำลังอ่าน */
const ACTIVE_WINDOW_MS = 30_000;

interface Doc {
  id: number;
  kind: string;
  fileName: string;
  pageCount: number;
  pagesSeen: number[];
  completed: boolean;
}

export function Reader({ assignmentId, documents, viewer }: { assignmentId: number; documents: Doc[]; viewer: string }) {
  const [openId, setOpenId] = useState<number | null>(documents.find((d) => !d.completed)?.id ?? documents[0]?.id ?? null);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {documents.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => setOpenId(d.id)}
            className={`rounded-lg border px-3 py-1.5 text-[13px] ${openId === d.id ? "border-ink bg-surface-2 font-semibold" : "border-line"}`}
          >
            {d.completed ? "✓ " : ""}
            {d.fileName} · {d.pagesSeen.length}/{d.pageCount} หน้า
          </button>
        ))}
      </div>
      {openId !== null && <PdfDoc key={openId} assignmentId={assignmentId} doc={documents.find((d) => d.id === openId)!} viewer={viewer} />}
    </div>
  );
}

function PdfDoc({ assignmentId, doc, viewer }: { assignmentId: number; doc: Doc; viewer: string }) {
  const confidential = doc.kind === "pricelist";
  const router = useRouter();
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [seen, setSeen] = useState<Set<number>>(new Set(doc.pagesSeen));
  const pending = useRef<Set<number>>(new Set());
  const activeSeconds = useRef(0);
  const lastActivity = useRef(Date.now());

  // โหลดและวาดทุกหน้า
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const link = await documentLinkAction({ assignmentId, documentId: doc.id });
      if (!link.ok) {
        if (link.error === "session_ended") return router.refresh();
        return setError(link.error);
      }
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
      const pdf = await pdfjs.getDocument({ url: link.url }).promise;
      if (cancelled) return;
      // effect อาจรันซ้ำ (strict mode / เปลี่ยนเอกสาร) — ล้างหน้าที่วาดค้างไว้ก่อน
      container.current?.replaceChildren();
      for (let n = 1; n <= pdf.numPages && !cancelled; n++) {
        const page = await pdf.getPage(n);
        if (cancelled) return;
        // ★ `||` ไม่ใช่ `??` — ก่อน layout เสร็จ clientWidth เป็น 0 แล้วหน้าแรกจะกว้าง 0
        const width = container.current?.clientWidth || 800;
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: (width / base.width) * (window.devicePixelRatio || 1) });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = "100%";
        canvas.dataset.page = String(n);
        canvas.className = "mb-3 rounded border border-line";
        container.current?.appendChild(canvas);
        await page.render({ canvas, viewport }).promise;
      }
    })().catch(() => setError("เปิดเอกสารไม่ได้ ลองรีเฟรชหน้า"));
    return () => {
      cancelled = true;
    };
  }, [assignmentId, doc.id, router]);

  // หน้าที่เห็นเกินครึ่ง = เลื่อนผ่านแล้ว
  useEffect(() => {
    const root = container.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const n = Number((e.target as HTMLElement).dataset.page);
          pending.current.add(n);
          setSeen((s) => (s.has(n) ? s : new Set(s).add(n)));
        }
      },
      { threshold: 0.5 },
    );
    const mo = new MutationObserver(() => root.querySelectorAll("canvas").forEach((c) => io.observe(c)));
    mo.observe(root, { childList: true });
    return () => {
      io.disconnect();
      mo.disconnect();
    };
  }, []);

  // เวลาอ่าน: นับทีละวินาทีเฉพาะตอนแท็บอยู่หน้าและขยับภายใน 30 วินาที · ส่งทุก 15 วินาที
  useEffect(() => {
    const bump = () => (lastActivity.current = Date.now());
    const events = ["scroll", "mousemove", "keydown", "touchstart", "wheel"] as const;
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const tick = setInterval(() => {
      if (document.visibilityState === "visible" && Date.now() - lastActivity.current < ACTIVE_WINDOW_MS) activeSeconds.current += 1;
    }, 1000);
    const flush = async () => {
      const pages = [...pending.current];
      const secs = activeSeconds.current;
      if (!pages.length && !secs) return;
      pending.current.clear();
      activeSeconds.current = 0;
      const out = await readingBeatAction({ assignmentId, documentId: doc.id, pages, activeSeconds: secs });
      if (!out.ok && out.error === "session_ended") router.refresh();
      else if (out.ok && out.completed) router.refresh();
    };
    const beat = setInterval(flush, BEAT_MS);
    const onHide = () => document.visibilityState === "hidden" && void flush();
    document.addEventListener("visibilitychange", onHide);
    return () => {
      events.forEach((e) => window.removeEventListener(e, bump));
      clearInterval(tick);
      clearInterval(beat);
      document.removeEventListener("visibilitychange", onHide);
      void flush();
    };
  }, [assignmentId, doc.id, router]);

  return (
    <div>
      <p className="mb-2 text-[12px] text-ink-3">
        เลื่อนผ่านแล้ว {seen.size}/{doc.pageCount} หน้า — ต้องครบทุกหน้าก่อนสอบ
      </p>
      {confidential && <p className="mb-2 text-[12px] text-danger">Pricelist — ดูในระบบเท่านั้น · ทุกหน้ามีชื่อของคุณและเวลาที่เปิด · ระบบบันทึกการเปิดทุกครั้ง</p>}
      {error && <p className="mb-2 text-[13px] text-danger">{error}</p>}
      {/* Pricelist: ซ้อนชื่อภาษาไทยบนหน้าจออีกชั้น (ในไฟล์ประทับอีเมล/รหัสไว้แล้วฝั่งเซิร์ฟเวอร์) · ปิดเมนูคลิกขวา */}
      <div className="relative" onContextMenu={confidential ? (e) => e.preventDefault() : undefined}>
        <div ref={container} className={confidential ? "select-none" : undefined} />
        {confidential && (
          <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="flex h-full flex-wrap content-start gap-x-24 gap-y-28 p-8 opacity-[0.12]" style={{ transform: "rotate(-30deg) scale(1.6)" }}>
              {Array.from({ length: 60 }, (_, i) => (
                <span key={i} className="whitespace-nowrap text-[18px] font-semibold text-danger">
                  {viewer}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
