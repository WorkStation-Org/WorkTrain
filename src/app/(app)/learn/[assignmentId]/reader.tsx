"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { formatDuration, isVideoMime, MAX_VIDEO_PLAYBACK_RATE, segmentWatchTarget, VIDEO_SEGMENT_SECONDS } from "@/domain/document";
import { documentLinkAction, readingBeatAction } from "../actions";

/**
 * ตัวอ่านเอกสาร (spec §9) — แสดง PDF ทีละหน้า · นับหน้าที่เลื่อนผ่าน · นับเวลาเฉพาะตอนแท็บอยู่หน้าและมีการขยับ
 *
 * ★ เบราว์เซอร์แค่รายงาน — เซิร์ฟเวอร์เป็นคนตัดสินว่าอ่านครบไหม (จำนวนหน้าจากไฟล์จริง · จำกัดเวลาต่อครั้ง)
 * ★ เซิร์ฟเวอร์ตอบ `session_ended` (นิ่งเกิน 2 นาที) = รีเฟรชหน้า → ปุ่มสแกนเพื่อเรียนต่อ
 * ★ วิดีโอ (ADR-0013): นับช่วงละ 10 วินาทีที่เล่นผ่านจริง (`video.played` — กรอข้ามไม่นับ) · เร็วสุด 2 เท่า ·
 *   ลิงก์หมดอายุกลางเรื่อง = ขอใหม่แล้วเล่นต่อจากจุดเดิม
 * ★ pdfjs ≥ 6.2.108 เท่านั้น (GHSA-hq66-cqwq-w95j: รัน JavaScript จาก PDF ที่ประสงค์ร้ายได้) — ไฟล์มาจากผู้สร้างในบริษัท แต่ไม่ไว้ใจเนื้อไฟล์
 */

const BEAT_MS = 15_000;
/** ขยับล่าสุดภายในเวลานี้ = ยังนับว่ากำลังอ่าน */
const ACTIVE_WINDOW_MS = 30_000;
/** ลิงก์ที่ขอใหม่ภายในเวลานี้แล้วยังเล่นไม่ได้ = ไฟล์มีปัญหา ไม่ใช่ลิงก์หมดอายุ */
const RELINK_GUARD_MS = 10_000;

interface Doc {
  id: number;
  kind: string;
  fileName: string;
  mimeType: string;
  durationSeconds: number | null;
  pageCount: number;
  pagesSeen: number[];
  completed: boolean;
}

export function Reader({ assignmentId, documents, viewer }: { assignmentId: number; documents: Doc[]; viewer: string }) {
  const [openId, setOpenId] = useState<number | null>(documents.find((d) => !d.completed)?.id ?? documents[0]?.id ?? null);
  const open = documents.find((d) => d.id === openId);
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
            {isVideoMime(d.mimeType) ? "▶ " : ""}
            {d.fileName} · {d.pagesSeen.length}/{d.pageCount} {isVideoMime(d.mimeType) ? "ช่วง" : "หน้า"}
          </button>
        ))}
      </div>
      {open &&
        (isVideoMime(open.mimeType) ? (
          <VideoDoc key={open.id} assignmentId={assignmentId} doc={open} />
        ) : (
          <PdfDoc key={open.id} assignmentId={assignmentId} doc={open} viewer={viewer} />
        ))}
    </div>
  );
}

/**
 * ส่งความคืบหน้าให้เซิร์ฟเวอร์ทุก 15 วินาที + ตอนซ่อนแท็บ/ปิดเอกสาร — ใช้ร่วมกันทั้ง PDF และวิดีโอ
 * นับเวลาทีละวินาทีเฉพาะตอนแท็บอยู่หน้า และ (ขยับภายใน 30 วินาที หรือ `busy()` เช่นวิดีโอกำลังเล่น)
 * คืนกล่องหน้า/ช่วงที่รอส่ง — ตัวแสดงผลเติมเข้าไปเอง
 */
function useProgressBeat(assignmentId: number, documentId: number, busy: () => boolean) {
  const router = useRouter();
  const pending = useRef<Set<number>>(new Set());
  const activeSeconds = useRef(0);
  const lastActivity = useRef(Date.now());
  const busyRef = useRef(busy);
  useEffect(() => {
    busyRef.current = busy;
  });

  useEffect(() => {
    const bump = () => (lastActivity.current = Date.now());
    const events = ["scroll", "mousemove", "keydown", "touchstart", "wheel"] as const;
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const tick = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (busyRef.current() || Date.now() - lastActivity.current < ACTIVE_WINDOW_MS) activeSeconds.current += 1;
    }, 1000);
    const flush = async () => {
      const pages = [...pending.current];
      const secs = activeSeconds.current;
      if (!pages.length && !secs) return;
      pending.current.clear();
      activeSeconds.current = 0;
      const out = await readingBeatAction({ assignmentId, documentId, pages, activeSeconds: secs });
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
  }, [assignmentId, documentId, router]);

  return pending;
}

function VideoDoc({ assignmentId, doc }: { assignmentId: number; doc: Doc }) {
  const router = useRouter();
  const video = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seen, setSeen] = useState<Set<number>>(() => new Set(doc.pagesSeen));
  const seenRef = useRef(seen);
  const linkedAt = useRef(0);
  /** จุดที่ต้องเล่นต่อหลังเปลี่ยนลิงก์ */
  const resume = useRef<{ time: number; play: boolean } | null>(null);
  const pending = useProgressBeat(assignmentId, doc.id, () => {
    const v = video.current;
    return Boolean(v && !v.paused && !v.ended);
  });
  const duration = doc.durationSeconds ?? doc.pageCount * VIDEO_SEGMENT_SECONDS;

  async function link(): Promise<void> {
    linkedAt.current = Date.now();
    const out = await documentLinkAction({ assignmentId, documentId: doc.id });
    if (!out.ok) {
      if (out.error === "session_ended") return router.refresh();
      return setError(out.error);
    }
    setSrc(out.url);
  }

  // ขอลิงก์ครั้งแรก — ครั้งเดียวต่อเอกสาร (key ของคอมโพเนนต์คือ doc.id)
  useEffect(() => {
    let cancelled = false;
    linkedAt.current = Date.now();
    documentLinkAction({ assignmentId, documentId: doc.id })
      .then((out) => {
        if (cancelled) return;
        if (!out.ok) return out.error === "session_ended" ? router.refresh() : setError(out.error);
        setSrc(out.url);
      })
      .catch(() => !cancelled && setError("เปิดวิดีโอไม่ได้ ลองรีเฟรชหน้า"));
    return () => {
      cancelled = true;
    };
  }, [assignmentId, doc.id, router]);

  /** ช่วงที่เล่นผ่านแล้วอย่างน้อย 80% ตาม `video.played` (กรอข้ามไม่เข้า played) */
  function collect() {
    const v = video.current;
    if (!v) return;
    const ranges = v.played;
    const added: number[] = [];
    for (let n = 1; n <= doc.pageCount; n++) {
      if (seenRef.current.has(n)) continue;
      const start = (n - 1) * VIDEO_SEGMENT_SECONDS;
      const end = start + VIDEO_SEGMENT_SECONDS;
      let covered = 0;
      for (let i = 0; i < ranges.length; i++) covered += Math.max(0, Math.min(end, ranges.end(i)) - Math.max(start, ranges.start(i)));
      if (covered > 0 && covered >= segmentWatchTarget(n, duration)) added.push(n);
    }
    if (!added.length) return;
    const next = new Set(seenRef.current);
    for (const n of added) {
      next.add(n);
      pending.current.add(n);
    }
    seenRef.current = next;
    setSeen(next);
  }

  function onLoadedMetadata() {
    const v = video.current;
    if (!v) return;
    if (resume.current) {
      v.currentTime = resume.current.time;
      if (resume.current.play) void v.play().catch(() => undefined);
      resume.current = null;
      return;
    }
    // เปิดครั้งแรก: เริ่มที่ช่วงแรกที่ยังไม่ได้ดู
    const firstUnseen = Array.from({ length: doc.pageCount }, (_, i) => i + 1).find((n) => !seenRef.current.has(n));
    if (firstUnseen && firstUnseen > 1) v.currentTime = (firstUnseen - 1) * VIDEO_SEGMENT_SECONDS;
  }

  function onRateChange() {
    const v = video.current;
    if (v && v.playbackRate > MAX_VIDEO_PLAYBACK_RATE) v.playbackRate = MAX_VIDEO_PLAYBACK_RATE;
  }

  function onError() {
    const v = video.current;
    if (!v || !src) return;
    // ลิงก์หมดอายุระหว่างดู → ขอใหม่แล้วเล่นต่อจากจุดเดิม · ขอใหม่แล้วยังพัง = ไฟล์เล่นไม่ได้
    if (Date.now() - linkedAt.current < RELINK_GUARD_MS) {
      return setError("เล่นวิดีโอนี้ไม่ได้ — เบราว์เซอร์อาจไม่รองรับรูปแบบไฟล์ แจ้งผู้สร้างชุดให้ export เป็น MP4 H.264");
    }
    collect();
    resume.current = { time: v.currentTime, play: !v.paused };
    void link().catch(() => setError("เปิดวิดีโอไม่ได้ ลองรีเฟรชหน้า"));
  }

  return (
    <div>
      <p className="mb-2 text-[12px] text-ink-3">
        ดูแล้ว {seen.size}/{doc.pageCount} ช่วง (ช่วงละ {VIDEO_SEGMENT_SECONDS} วินาที · ยาว {formatDuration(duration)}) — ต้องเล่นผ่านครบทุกช่วงก่อนสอบ ·
        กรอข้ามได้แต่ช่วงที่ข้ามไม่นับ · เร็วสุด {MAX_VIDEO_PLAYBACK_RATE} เท่า
      </p>
      {error && <p className="mb-2 text-[13px] text-danger">{error}</p>}
      <video
        ref={video}
        src={src ?? undefined}
        controls
        playsInline
        preload="metadata"
        controlsList="nodownload"
        disablePictureInPicture
        onContextMenu={(e) => e.preventDefault()}
        onLoadedMetadata={onLoadedMetadata}
        onTimeUpdate={collect}
        onPause={collect}
        onEnded={collect}
        onRateChange={onRateChange}
        onError={onError}
        className="aspect-video w-full rounded border border-line bg-black"
      />
      <SegmentBar total={doc.pageCount} seen={seen} />
    </div>
  );
}

/** แถบช่วงที่ดูแล้ว — แต่ละขีดคือช่วง 10 วินาที */
function SegmentBar({ total, seen }: { total: number; seen: Set<number> }) {
  return (
    <div className="mt-2 flex h-2 w-full gap-px overflow-hidden rounded-full bg-subtle" role="img" aria-label={`ดูแล้ว ${seen.size} จาก ${total} ช่วง`}>
      {Array.from({ length: total }, (_, i) => (
        <div key={i} className={`h-full flex-1 ${seen.has(i + 1) ? "bg-success" : ""}`} />
      ))}
    </div>
  );
}

function PdfDoc({ assignmentId, doc, viewer }: { assignmentId: number; doc: Doc; viewer: string }) {
  const confidential = doc.kind === "pricelist";
  const router = useRouter();
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [seen, setSeen] = useState<Set<number>>(new Set(doc.pagesSeen));
  const pending = useProgressBeat(assignmentId, doc.id, () => false);

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
  }, [pending]);

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
