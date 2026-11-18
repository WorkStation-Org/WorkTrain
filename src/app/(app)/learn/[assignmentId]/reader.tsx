"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { formatDuration, isVideoMime, MAX_VIDEO_PLAYBACK_RATE, segmentWatchTarget, VIDEO_SEGMENT_SECONDS } from "@/domain/document";
import { documentLinkAction, readingBeatAction } from "../actions";

/**
 * หน้าเรียน (spec §9 · ADR-0013) — ตัวแสดงเนื้อหาทางซ้าย · รายการเนื้อหาในชุดทางขวา (คลิปและ PDF ตามลำดับ) · การ์ดสอบใต้รายการ
 *
 * ★ เบราว์เซอร์แค่รายงาน — เซิร์ฟเวอร์เป็นคนตัดสินว่าอ่านครบไหม (จำนวนหน้าจากไฟล์จริง · จำกัดเวลาต่อครั้ง)
 * ★ เซิร์ฟเวอร์ตอบ `session_ended` (นิ่งเกิน 2 นาที) = รีเฟรชหน้า → ปุ่มสแกนเพื่อเรียนต่อ
 * ★ วิดีโอ: นับช่วงละ 10 วินาทีที่เล่นผ่านจริง (`video.played` — กรอข้ามไม่นับ) · เร็วสุด 2 เท่า ·
 *   ลิงก์หมดอายุกลางเรื่อง = ขอใหม่แล้วเล่นต่อจากจุดเดิม
 * ★ ดูได้ทีละคลิป (ADR-0020) — แท็บไหนกดเล่น แท็บอื่นหยุด · เซิร์ฟเวอร์ตอบ `video_elsewhere` = หยุดและไม่นับส่วนที่เพิ่งดู
 * ★ `review` (สอบผ่านแล้ว) = เปิดซ้ำได้ไม่จำกัด ไม่ส่งความคืบหน้า กรอ/เร่งได้อิสระ
 * ★ pdfjs ≥ 6.2.108 เท่านั้น (GHSA-hq66-cqwq-w95j: รัน JavaScript จาก PDF ที่ประสงค์ร้ายได้) — ไฟล์มาจากผู้สร้างในบริษัท แต่ไม่ไว้ใจเนื้อไฟล์
 */

const BEAT_MS = 15_000;
/** ขยับล่าสุดภายในเวลานี้ = ยังนับว่ากำลังอ่าน */
const ACTIVE_WINDOW_MS = 30_000;
/** ลิงก์ที่ขอใหม่ภายในเวลานี้แล้วยังเล่นไม่ได้ = ไฟล์มีปัญหา ไม่ใช่ลิงก์หมดอายุ */
const RELINK_GUARD_MS = 10_000;
/** เนื้อหาเกินจำนวนนี้ถึงแสดงช่องค้นหาในรายการ */
const SEARCH_FROM = 5;

export interface LessonDoc {
  id: number;
  kind: string;
  fileName: string;
  mimeType: string;
  durationSeconds: number | null;
  /** ปกที่ผู้สร้างเลือกจากเฟรมในคลิป (ADR-0013) · null = ยังไม่มี */
  coverUrl: string | null;
  pageCount: number;
  pagesSeen: number[];
  completed: boolean;
}

/**
 * พื้นที่เรียนทั้งหมด — `active` = มีรอบเรียนเปิดอยู่ (เปิดเนื้อหาได้) · ไม่มี = ซ้ายแสดง `start` (ปุ่มสแกน) แทนตัวแสดง
 * `exam` = การ์ดสอบเมื่อพร้อมสอบ · ไม่ส่ง = การ์ดบอกว่าเหลืออีกกี่รายการ (นับสดตามที่ดู/อ่านในหน้านี้)
 */
export function LessonWorkspace({
  assignmentId,
  documents,
  viewer,
  active,
  start,
  exam,
  examRules,
  review = false,
}: {
  assignmentId: number;
  documents: LessonDoc[];
  viewer: string;
  active: boolean;
  /** สอบผ่านแล้ว — เปิดซ้ำได้ไม่จำกัด ไม่ส่งความคืบหน้า · การ์ดสอบเปลี่ยนเป็นคำอธิบายการทบทวน */
  review?: boolean;
  start?: ReactNode;
  exam?: ReactNode;
  /** กติกาการสอบ — แสดงเป็นรายการก่อนปุ่มเริ่มสอบ */
  examRules: string[];
}) {
  const [openId, setOpenId] = useState<number | null>(documents.find((d) => !d.completed)?.id ?? documents[0]?.id ?? null);
  const [seenCount, setSeenCount] = useState<Record<number, number>>(() => Object.fromEntries(documents.map((d) => [d.id, d.pagesSeen.length])));
  const open = documents.find((d) => d.id === openId);
  const isDone = (d: LessonDoc) => d.completed || (seenCount[d.id] ?? 0) >= d.pageCount;
  const doneCount = documents.filter(isDone).length;
  const remaining = documents.length - doneCount;
  const onSeen = (id: number) => (n: number) => setSeenCount((s) => (s[id] === n ? s : { ...s, [id]: n }));

  const videos = documents.filter((d) => isVideoMime(d.mimeType));
  const pdfs = documents.filter((d) => !isVideoMime(d.mimeType));
  const summary = [
    videos.length ? `${videos.length} วิดีโอ · รวม ${formatDuration(videos.reduce((s, d) => s + (d.durationSeconds ?? d.pageCount * VIDEO_SEGMENT_SECONDS), 0))}` : null,
    pdfs.length ? `${pdfs.length} PDF ${pdfs.reduce((s, d) => s + d.pageCount, 0)} หน้า` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  let clip = 0;
  const clipNo = new Map(videos.map((d) => [d.id, ++clip]));
  /** ชื่อที่แสดงในรายการ — คลิปขึ้นต้นด้วยเลขตอน `EP.1` ตามลำดับที่ผู้สร้างจัดไว้ */
  const titleOf = (d: LessonDoc) => (clipNo.has(d.id) ? `EP.${clipNo.get(d.id)} ${d.fileName}` : d.fileName);
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = needle ? documents.filter((d) => titleOf(d).toLowerCase().includes(needle)) : documents;
  // รายการยาว (เกิน SEARCH_FROM รายการ) ถึงมีช่องค้นหา — ชุดสั้นไม่ต้องเห็นช่องที่ไม่จำเป็น
  const searchable = documents.length > SEARCH_FROM;
  const listRef = useRef<HTMLOListElement>(null);
  const currentRef = useRef<HTMLLIElement>(null);
  // เลื่อนเฉพาะในกรอบรายการให้เห็นรายการที่เปิดอยู่ — ไม่ใช้ scrollIntoView เพราะจะพาทั้งหน้าเลื่อนตามบนมือถือ
  useEffect(() => {
    const list = listRef.current;
    const item = currentRef.current;
    if (!list || !item) return;
    const top = item.offsetTop - list.offsetTop;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + item.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + item.offsetHeight - list.clientHeight;
  }, [openId]);

  return (
    <div className="flex flex-wrap items-start gap-5">
      <section aria-label="ตัวแสดงเนื้อหา" className="min-w-0 flex-[999_1_560px]">
        {active && open ? (
          isVideoMime(open.mimeType) ? (
            <VideoDoc
              key={open.id}
              assignmentId={assignmentId}
              doc={open}
              label={`EP.${clipNo.get(open.id)} จาก ${videos.length} คลิป`}
              onSeen={onSeen(open.id)}
              counting={!review}
            />
          ) : (
            <PdfDoc key={open.id} assignmentId={assignmentId} doc={open} viewer={viewer} onSeen={onSeen(open.id)} counting={!review} />
          )
        ) : (
          start
        )}
      </section>

      {/* จอกว้าง: แผงขวาเกาะใต้แถบบน · รายการเลื่อนในกรอบของตัวเอง — ตัวเล่นทางซ้ายไม่หลุดจอตอนไล่หาคลิป */}
      <aside aria-label="เนื้อหาในชุด" className="flex min-w-0 flex-[1_1_320px] flex-col gap-4 xl:sticky xl:top-[92px]">
        <div className="overflow-hidden rounded-[13px] border border-line bg-raised">
          <div className="space-y-2 border-b border-line px-4 pb-3 pt-4">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-[15px] font-semibold text-fg">เนื้อหาในชุด</h2>
              <span className="text-[13px] text-muted">
                ครบ {doneCount}/{documents.length}
              </span>
            </div>
            <ProgressLine percent={documents.length ? (doneCount / documents.length) * 100 : 0} done={remaining === 0} />
            <p className="text-[13px] text-muted">{summary}</p>
            {searchable && (
              <label className="flex h-11 items-center gap-2 rounded-[10px] border border-line-strong bg-canvas px-3">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0 text-muted" aria-hidden>
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
                <span className="sr-only">ค้นหาชื่อคลิปหรือเอกสาร</span>
                <input
                  type="search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="ค้นหาชื่อคลิป หรือ EP.3"
                  className="min-w-0 flex-1 bg-transparent text-[14px] text-fg outline-none placeholder:text-muted"
                />
              </label>
            )}
          </div>
          <ol ref={listRef} aria-label="รายการเนื้อหา" className="thin-scroll max-h-[min(62dvh,560px)] overflow-y-auto overscroll-contain p-1.5">
            {shown.length === 0 && <li className="px-3 py-8 text-center text-[13px] text-muted">ไม่พบคลิปหรือเอกสารที่ชื่อมี “{q.trim()}”</li>}
            {shown.map((d) => {
              const video = isVideoMime(d.mimeType);
              const seen = Math.min(seenCount[d.id] ?? 0, d.pageCount);
              const done = isDone(d);
              const current = active && d.id === openId;
              return (
                <li key={d.id} ref={current ? currentRef : undefined}>
                  <button
                    type="button"
                    onClick={() => setOpenId(d.id)}
                    disabled={!active}
                    aria-current={current ? "true" : undefined}
                    className={`flex min-h-16 w-full items-center gap-3 rounded-[10px] p-2.5 text-left disabled:cursor-default ${current ? "bg-subtle" : "enabled:hover:bg-subtle"}`}
                  >
                    <Thumb video={video} cover={d.coverUrl} length={video ? formatDuration(d.durationSeconds ?? d.pageCount * VIDEO_SEGMENT_SECONDS) : null} />
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="break-words text-[14px] font-semibold leading-snug text-fg">
                        {video && <span className="mr-1.5 font-semibold text-muted">EP.{clipNo.get(d.id)}</span>}
                        {d.fileName}
                      </span>
                      <span className="text-[13px] text-muted">
                        {video
                          ? done
                            ? "ดูครบแล้ว"
                            : `ดูแล้ว ${watchedLabel(d, seen)}`
                          : done
                            ? `อ่านครบ ${d.pageCount} หน้า`
                            : `อ่านแล้ว ${seen}/${d.pageCount} หน้า`}
                        {d.kind === "pricelist" ? " · Pricelist" : ""}
                      </span>
                      <ProgressLine percent={(seen / d.pageCount) * 100} done={done} thin />
                    </span>
                    {done ? (
                      <span className="shrink-0 text-[13px] font-bold text-success" aria-label="ครบแล้ว">
                        ✓
                      </span>
                    ) : current ? (
                      <span className="shrink-0 text-[13px] font-semibold text-ink-2">{video ? "กำลังดู" : "กำลังอ่าน"}</span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ol>
        </div>

        {review ? (
          <div className="space-y-1.5 rounded-[13px] border border-line bg-raised p-4">
            <h2 className="text-[15px] font-semibold text-fg">ทบทวนบทเรียน</h2>
            <p className="text-[14px] leading-relaxed text-ink-2">
              สอบผ่านแล้ว — เปิดคลิปและเอกสารซ้ำได้ทุกเมื่อ ไม่ต้องสแกน ไม่นับเวลา และไม่ต้องสอบใหม่
            </p>
          </div>
        ) : (
          <div className="space-y-2.5 rounded-[13px] border border-line bg-raised p-4">
            <h2 className="text-[15px] font-semibold text-fg">ก่อนเริ่มสอบ</h2>
            <ul className="list-disc space-y-1 pl-5 text-[14px] leading-relaxed text-ink-2">
              {examRules.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            {exam ?? (
              <p className="rounded-[10px] border border-dashed border-ink-4 bg-canvas px-3 py-3 text-center text-[13px] text-muted">
                {remaining > 0
                  ? `เริ่มสอบได้เมื่อดู/อ่านครบ — เหลืออีก ${remaining} รายการ`
                  : "ดู/อ่านครบแล้ว กำลังบันทึกความคืบหน้า — ปุ่มเริ่มสอบจะขึ้นเองในไม่กี่วินาที อย่าเพิ่งปิดหน้านี้"}
              </p>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

/** เวลาที่ดูแล้วของคลิป — `0:20 จาก 0:42 · เหลือ 0:22` (นับจากช่วงละ 10 วินาทีที่ระบบนับแล้ว) */
function watchedLabel(d: Pick<LessonDoc, "durationSeconds" | "pageCount">, segments: number): string {
  const length = d.durationSeconds ?? d.pageCount * VIDEO_SEGMENT_SECONDS;
  const watched = Math.min(length, segments * VIDEO_SEGMENT_SECONDS);
  return `${formatDuration(watched)} จาก ${formatDuration(length)} · เหลือ ${formatDuration(length - watched)}`;
}

function ProgressLine({ percent, done, thin = false }: { percent: number; done: boolean; thin?: boolean }) {
  return (
    <span className={`block overflow-hidden rounded-full bg-subtle ${thin ? "h-1" : "h-1.5"}`}>
      <span className={`block h-full rounded-full ${done ? "bg-success" : "bg-fg"}`} style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
    </span>
  );
}

function PlayGlyph({ size = 14, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

/** ภาพย่อในรายการ — วิดีโอใช้ปกที่ผู้สร้างเลือก (ไม่มีปก = กล่องเข้ม) พร้อมความยาว · PDF เป็นไอคอนเอกสาร */
function Thumb({ video, cover, length }: { video: boolean; cover: string | null; length: string | null }) {
  return video ? (
    <span className="relative flex aspect-video w-[88px] shrink-0 items-center justify-center overflow-hidden rounded-md bg-[#2c2e32] text-white">
      {/* eslint-disable-next-line @next/next/no-img-element -- ภาพผ่าน route ที่ตรวจสิทธิ์ ไม่ผ่าน next/image */}
      {cover && <img src={cover} alt="" className="absolute inset-0 size-full object-cover" />}
      <span className={`relative flex items-center justify-center ${cover ? "size-6 rounded-full bg-black/55" : ""}`}>
        <PlayGlyph size={cover ? 11 : 14} />
      </span>
      <span className="absolute bottom-[3px] right-1 rounded-[3px] bg-black/60 px-1 text-[10px] leading-4">{length}</span>
    </span>
  ) : (
    <span className="flex aspect-video w-[88px] shrink-0 items-center justify-center rounded-md border border-line bg-subtle text-muted">
      <svg width="16" height="20" viewBox="0 0 40 48" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden>
        <path d="M6 2h20l10 10v34H6z" />
        <path d="M26 2v10h10" />
      </svg>
    </span>
  );
}

/**
 * ส่งความคืบหน้าให้เซิร์ฟเวอร์ทุก 15 วินาที + ตอนซ่อนแท็บ/ปิดเอกสาร — ใช้ร่วมกันทั้ง PDF และวิดีโอ
 * นับเวลาทีละวินาทีเฉพาะตอนแท็บอยู่หน้า และ (ขยับภายใน 30 วินาที หรือ `busy()` เช่นวิดีโอกำลังเล่น)
 * คืนกล่องหน้า/ช่วงที่รอส่ง (ตัวแสดงผลเติมเข้าไปเอง) + `release()` ปล่อยการนับคลิปนี้ให้คลิปอื่น (ADR-0020)
 * `counting: false` (ทบทวนหลังผ่าน) = ไม่ส่งอะไรเลย
 */
function useProgressBeat(
  assignmentId: number,
  documentId: number,
  busy: () => boolean,
  opts: { counting: boolean; video?: boolean; onElsewhere?: (pages: number[]) => void },
) {
  const router = useRouter();
  const pending = useRef<Set<number>>(new Set());
  const activeSeconds = useRef(0);
  const lastActivity = useRef(Date.now());
  /** คลิปนี้เป็นคนนับอยู่ที่เซิร์ฟเวอร์ — ปิดคลิปแล้วต้องปล่อย */
  const held = useRef(false);
  const busyRef = useRef(busy);
  const elsewhereRef = useRef(opts.onElsewhere);
  const flushRef = useRef<(release?: boolean) => Promise<void>>(async () => undefined);
  useEffect(() => {
    busyRef.current = busy;
    elsewhereRef.current = opts.onElsewhere;
  });
  const { counting, video = false } = opts;

  useEffect(() => {
    if (!counting) return;
    const bump = () => (lastActivity.current = Date.now());
    const events = ["scroll", "mousemove", "keydown", "touchstart", "wheel"] as const;
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const tick = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (busyRef.current() || Date.now() - lastActivity.current < ACTIVE_WINDOW_MS) activeSeconds.current += 1;
    }, 1000);
    const flush = async (release = false) => {
      const pages = [...pending.current];
      const secs = activeSeconds.current;
      const releasing = release && video && held.current;
      if (!pages.length && !secs && !releasing) return;
      pending.current.clear();
      activeSeconds.current = 0;
      if (releasing) held.current = false;
      // ส่งไม่ถึง (เน็ตหลุด) = คืนเข้าคิวทั้งหมด ส่งใหม่รอบหน้า
      const out = await readingBeatAction({ assignmentId, documentId, pages, activeSeconds: secs, release: releasing }).catch(() => null);
      if (!out) {
        for (const p of pages) pending.current.add(p);
        activeSeconds.current += secs;
        return;
      }
      if (!out.ok && out.error === "session_ended") return router.refresh();
      // มีคลิปอื่นนับอยู่ (อีกแท็บ/อีกเครื่อง) — ที่ส่งไปไม่นับและไม่ส่งซ้ำ ตัวเล่นหยุดและล้างส่วนที่เพิ่งดู
      if (!out.ok && out.error === "video_elsewhere") {
        held.current = false;
        if (!releasing && (pages.length || secs)) elsewhereRef.current?.(pages);
        return;
      }
      if (!out.ok) return;
      if (video && !releasing && (pages.length || secs)) held.current = true;
      // ช่วงวิดีโอที่เกินเพดานต่อครั้งเซิร์ฟเวอร์ยังไม่นับ — ส่งซ้ำรอบหน้า (เพดาน +1 ช่วงทุกครั้ง แม้นิ่ง จึงทยอยครบเอง)
      const saved = new Set(out.seen);
      for (const p of pages) if (!saved.has(p)) pending.current.add(p);
      if (out.completed) router.refresh();
    };
    flushRef.current = flush;
    const beat = setInterval(() => void flush(), BEAT_MS);
    const onHide = () => document.visibilityState === "hidden" && void flush();
    document.addEventListener("visibilitychange", onHide);
    return () => {
      events.forEach((e) => window.removeEventListener(e, bump));
      clearInterval(tick);
      clearInterval(beat);
      document.removeEventListener("visibilitychange", onHide);
      flushRef.current = async () => undefined;
      // ปิดคลิป/เปลี่ยนไปคลิปอื่น = ส่งที่ค้างพร้อมปล่อยการนับ
      void flush(true);
    };
  }, [assignmentId, documentId, router, counting, video]);

  return { pending, release: () => void flushRef.current(true) };
}

/** ช่องคุยระหว่างแท็บของเว็บเดียวกัน — แท็บไหนกดเล่น แท็บอื่นหยุด (ADR-0020) · เบราว์เซอร์ที่ไม่มี = เซิร์ฟเวอร์ยังกันอยู่ */
const PLAY_CHANNEL = "worktrain-video-playing";
function openPlayChannel(): BroadcastChannel | null {
  return typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(PLAY_CHANNEL);
}

function VideoDoc({
  assignmentId,
  doc,
  label,
  onSeen,
  counting,
}: {
  assignmentId: number;
  doc: LessonDoc;
  label: string;
  onSeen: (n: number) => void;
  /** false = ทบทวนหลังผ่าน — กรอ/เร่งได้อิสระ ไม่ส่งความคืบหน้า */
  counting: boolean;
}) {
  const router = useRouter();
  const video = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** ทำไมตัวเล่นหยุดเอง — อีกแท็บเริ่มเล่น / มีคลิปอื่นนับอยู่ */
  const [notice, setNotice] = useState<string | null>(null);
  const [seen, setSeen] = useState<Set<number>>(() => new Set(doc.pagesSeen));
  const [playingSegment, setPlayingSegment] = useState<number | null>(null);
  const seenRef = useRef(seen);
  const linkedAt = useRef(0);
  /** จุดที่ต้องเล่นต่อหลังเปลี่ยนลิงก์ */
  const resume = useRef<{ time: number; play: boolean } | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  const beat = useProgressBeat(
    assignmentId,
    doc.id,
    () => {
      const v = video.current;
      return Boolean(v && !v.paused && !v.ended);
    },
    { counting, video: true, onElsewhere: voidUnsaved },
  );
  const pending = beat.pending;
  const duration = doc.durationSeconds ?? doc.pageCount * VIDEO_SEGMENT_SECONDS;

  /**
   * เซิร์ฟเวอร์ไม่นับเพราะมีคลิปอื่นนับอยู่ — หยุดเล่น · เอาช่วงที่ยังไม่ได้บันทึกออก · โหลดตัวเล่นใหม่ที่จุดเดิม
   * (ล้าง `video.played` — ไม่อย่างนั้นช่วงที่เล่นตอนชนกันจะถูกเก็บกลับเข้ามาอีก)
   */
  function voidUnsaved(sent: number[]) {
    const v = video.current;
    const drop = new Set([...sent, ...pending.current]);
    pending.current.clear();
    const next = new Set([...seenRef.current].filter((n) => !drop.has(n)));
    seenRef.current = next;
    setSeen(next);
    onSeen(next.size);
    setNotice("มีคลิปอื่นกำลังเล่นอยู่ในอีกแท็บหรืออีกเครื่อง — ดูได้ทีละคลิป ส่วนที่เพิ่งดูในแท็บนี้ไม่นับ ปิดคลิปนั้นก่อนแล้วกดเล่นต่อ");
    if (!v) return;
    v.pause();
    resume.current = { time: v.currentTime, play: false };
    v.load();
  }

  // แท็บอื่นกดเล่น = แท็บนี้หยุดและปล่อยการนับ (ADR-0020)
  useEffect(() => {
    const ch = openPlayChannel();
    channel.current = ch;
    if (!ch) return;
    ch.onmessage = () => {
      const v = video.current;
      if (v && !v.paused) {
        v.pause();
        setNotice("หยุดไว้ เพราะเริ่มเล่นคลิปในอีกแท็บ — ดูได้ทีละคลิป");
      }
      beat.release();
    };
    return () => {
      ch.close();
      channel.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `beat.release` อ่านจาก ref ทุกครั้ง
  }, []);

  function onPlay() {
    setNotice(null);
    channel.current?.postMessage("playing");
    collect();
  }

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
    if (!v || !counting) return;
    const now = v.paused || v.ended ? null : Math.min(doc.pageCount, Math.floor(v.currentTime / VIDEO_SEGMENT_SECONDS) + 1);
    setPlayingSegment((p) => (p === now ? p : now));
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
    onSeen(next.size);
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
    // เปิดครั้งแรก: เริ่มที่ช่วงแรกที่ยังไม่ได้ดู · ทบทวน = เริ่มต้นเรื่อง
    if (!counting) return;
    const firstUnseen = Array.from({ length: doc.pageCount }, (_, i) => i + 1).find((n) => !seenRef.current.has(n));
    if (firstUnseen && firstUnseen > 1) v.currentTime = (firstUnseen - 1) * VIDEO_SEGMENT_SECONDS;
  }

  function onRateChange() {
    const v = video.current;
    if (counting && v && v.playbackRate > MAX_VIDEO_PLAYBACK_RATE) v.playbackRate = MAX_VIDEO_PLAYBACK_RATE;
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

  // ช่วงที่ยังไม่นับแต่อยู่ก่อนจุดที่ดูไปไกลสุด = กรอข้ามไป
  const furthest = Math.max(0, ...seen, playingSegment ?? 0);

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-[13px] bg-[#161719]">
        <div className="flex items-baseline gap-3 px-4 pb-2 pt-3 text-white">
          <span className="shrink-0 text-[13px] tracking-wide text-[#a4a7ad]">{label}</span>
          <span className="min-w-0 truncate text-[14px] font-semibold">{doc.fileName}</span>
          <span className="ml-auto shrink-0 text-[13px] text-[#c9cbcf]">ยาว {formatDuration(duration)}</span>
        </div>
        <video
          ref={video}
          src={src ?? undefined}
          controls
          playsInline
          preload="metadata"
          poster={doc.coverUrl ?? undefined}
          controlsList="nodownload"
          disablePictureInPicture
          onContextMenu={(e) => e.preventDefault()}
          onLoadedMetadata={onLoadedMetadata}
          onTimeUpdate={collect}
          onPlay={onPlay}
          onPause={collect}
          onEnded={collect}
          onRateChange={onRateChange}
          onError={onError}
          className="block aspect-video w-full bg-black"
        />
      </div>
      {error && <p className="text-[13px] text-danger">{error}</p>}
      {notice && (
        <p role="status" className="rounded-[10px] border border-warn bg-warn-soft px-3.5 py-2.5 text-[13px] text-fg">
          {notice}
        </p>
      )}
      {!counting ? (
        <p className="rounded-[13px] border border-line bg-raised px-4 py-3.5 text-[13px] text-ink-2">
          ทบทวน — ดูซ้ำได้ไม่จำกัด กรอและเร่งได้อิสระ ระบบไม่นับเวลา และไม่ต้องสอบใหม่
        </p>
      ) : (
        <div className="space-y-2.5 rounded-[13px] border border-line bg-raised px-4 py-3.5">
          <div className="flex flex-wrap justify-between gap-2 text-[13px]">
            <span className="font-semibold text-fg">
              ดูแล้ว {watchedLabel(doc, seen.size)}
            </span>
            <span className="text-muted">กรอข้ามได้ แต่ส่วนที่ข้ามยังไม่นับ · เร่งได้ถึง {MAX_VIDEO_PLAYBACK_RATE} เท่า</span>
          </div>
          <div className="flex h-3.5 gap-px" role="img" aria-label={`ดูแล้ว ${watchedLabel(doc, seen.size)}`}>
            {Array.from({ length: doc.pageCount }, (_, i) => {
              const n = i + 1;
              const cls = seen.has(n)
                ? "bg-success"
                : n === playingSegment
                  ? "bg-fg"
                  : n < furthest
                    ? "border border-dashed border-ink-4 bg-line"
                    : "bg-subtle";
              return <span key={n} className={`min-w-0 flex-1 rounded-[2px] ${cls}`} />;
            })}
          </div>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink-2">
            <li className="flex items-center gap-1.5">
              <span className="size-3 rounded-[3px] bg-success" aria-hidden />
              ดูแล้ว
            </li>
            <li className="flex items-center gap-1.5">
              <span className="size-3 rounded-[3px] bg-fg" aria-hidden />
              กำลังเล่น
            </li>
            <li className="flex items-center gap-1.5">
              <span className="size-3 rounded-[3px] border border-dashed border-ink-4 bg-line" aria-hidden />
              ข้ามไป — ยังไม่นับ
            </li>
            <li className="flex items-center gap-1.5">
              <span className="size-3 rounded-[3px] bg-subtle" aria-hidden />
              ยังไม่ดู
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}

function PdfDoc({
  assignmentId,
  doc,
  viewer,
  onSeen,
  counting,
}: {
  assignmentId: number;
  doc: LessonDoc;
  viewer: string;
  onSeen: (n: number) => void;
  counting: boolean;
}) {
  const confidential = doc.kind === "pricelist";
  const router = useRouter();
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [seen, setSeen] = useState<Set<number>>(new Set(doc.pagesSeen));
  const { pending } = useProgressBeat(assignmentId, doc.id, () => false, { counting });

  useEffect(() => {
    onSeen(seen.size);
  }, [seen, onSeen]);

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
    <div className="rounded-[13px] border border-line bg-raised p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-[14px] font-semibold text-fg">{doc.fileName}</span>
        <span className="text-[13px] text-muted">
          {counting ? `อ่านแล้ว ${seen.size} จาก ${doc.pageCount} หน้า — เลื่อนให้ครบทุกหน้าก่อนสอบ` : `ทบทวน · ${doc.pageCount} หน้า`}
        </span>
      </div>
      {confidential && <p className="mb-2 text-[13px] text-danger">Pricelist — ดูในระบบเท่านั้น · ทุกหน้ามีชื่อของคุณและเวลาที่เปิด · ระบบบันทึกการเปิดทุกครั้ง</p>}
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
