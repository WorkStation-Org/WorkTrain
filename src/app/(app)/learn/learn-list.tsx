"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge, type BadgeTone } from "@/components/ui";

/**
 * รายการชุดที่ต้องเรียน (ตาม mockup) — แท็บกรอง + ค้นหาชื่อ + การ์ด (ปกคลิป · เนื้อหา · ความคืบหน้า · กำหนดส่ง)
 * ข้อมูลจัดรูปบนเซิร์ฟเวอร์แล้ว (วันที่เป็นข้อความ) — ที่นี่แค่กรองและแสดง
 */

export type CardFilter = "open" | "late" | "video" | "passed";

export interface LearnCard {
  href: string;
  title: string;
  kindName: string;
  badge: { tone: BadgeTone; label: string };
  contents: string;
  /** ชิปมุมปก — `3 คลิป · 24:10` */
  videoChip: string | null;
  coverUrl: string | null;
  hasVideo: boolean;
  percent: number;
  progressLabel: string;
  barTone: "fg" | "success" | "danger";
  dateLabel: string;
  groups: CardFilter[];
}

const TABS: { key: "all" | CardFilter; label: string }[] = [
  { key: "all", label: "ทั้งหมด" },
  { key: "open", label: "ยังไม่ผ่าน" },
  { key: "late", label: "เลยกำหนด" },
  { key: "video", label: "มีวิดีโอ" },
  { key: "passed", label: "ผ่านแล้ว" },
];

const BAR: Record<LearnCard["barTone"], string> = { fg: "bg-fg", success: "bg-success", danger: "bg-danger" };

export function LearnList({ cards }: { cards: LearnCard[] }) {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("all");
  const [q, setQ] = useState("");
  const counts = useMemo(
    () => Object.fromEntries(TABS.map((t) => [t.key, t.key === "all" ? cards.length : cards.filter((c) => c.groups.includes(t.key as CardFilter)).length])),
    [cards],
  );
  const needle = q.trim().toLowerCase();
  const shown = cards.filter((c) => (tab === "all" || c.groups.includes(tab)) && (!needle || c.title.toLowerCase().includes(needle)));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="กรองตามสถานะ" className="flex flex-wrap gap-1 rounded-xl bg-subtle p-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={`min-h-9 rounded-[9px] px-3.5 text-[13px] ${tab === t.key ? "bg-raised font-semibold text-fg shadow-sm" : "text-ink-2 hover:text-fg"}`}
            >
              {t.label} <span className="font-normal text-muted">{counts[t.key]}</span>
            </button>
          ))}
        </div>
        <label className="flex h-11 min-w-0 flex-[0_1_300px] items-center gap-2 rounded-[10px] border border-line-strong bg-raised px-3">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0 text-muted" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <span className="sr-only">ค้นหาชุด</span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ค้นหาชุด เช่น Signature"
            className="min-w-0 flex-1 bg-transparent text-[14px] text-fg outline-none placeholder:text-muted"
          />
        </label>
      </div>

      {shown.length === 0 ? (
        <p className="rounded-[13px] border border-dashed border-line-strong px-4 py-10 text-center text-[13px] text-muted">
          {needle ? `ไม่พบชุดที่ชื่อมี “${q.trim()}”` : "ไม่มีชุดในหมวดนี้"}
        </p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
          {shown.map((c) => (
            <li key={c.href}>
              <Link
                href={c.href}
                className="flex h-full flex-col overflow-hidden rounded-[13px] border border-line bg-raised transition-colors hover:border-line-strong focus-visible:outline-2 focus-visible:outline-fg"
              >
                <Cover card={c} />
                <div className="flex flex-1 flex-col gap-2.5 px-4 pb-4 pt-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[15px] font-semibold leading-snug text-fg">{c.title}</span>
                    <span className="shrink-0">
                      <Badge tone={c.badge.tone} label={c.badge.label} />
                    </span>
                  </div>
                  <span className="text-[12px] text-muted">{c.contents}</span>
                  <div className="mt-auto space-y-1.5">
                    <span className="block h-1.5 overflow-hidden rounded-full bg-subtle">
                      <span className={`block h-full rounded-full ${BAR[c.barTone]}`} style={{ width: `${c.percent}%` }} />
                    </span>
                    <span className="flex justify-between gap-2 text-[12px] text-muted">
                      <span>{c.progressLabel}</span>
                      <span>{c.dateLabel}</span>
                    </span>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Cover({ card }: { card: LearnCard }) {
  return (
    <div className={`relative flex aspect-video items-center justify-center overflow-hidden ${card.hasVideo ? "bg-[#2c2e32]" : "bg-subtle"}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- ภาพผ่าน route ที่ตรวจสิทธิ์ ไม่ผ่าน next/image */}
      {card.coverUrl && <img src={card.coverUrl} alt="" className="absolute inset-0 size-full object-cover" />}
      <span className={`absolute left-3 top-2.5 rounded px-1.5 text-[11px] tracking-wide ${card.hasVideo ? "bg-black/45 text-[#e7e8ea]" : "text-muted"}`}>
        {card.kindName}
      </span>
      {card.hasVideo ? (
        <>
          <span className="relative flex size-11 items-center justify-center rounded-full bg-white/90 text-[#161719]">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
          {card.videoChip && <span className="absolute bottom-2.5 right-2.5 rounded bg-black/60 px-1.5 text-[11px] leading-5 text-white">{card.videoChip}</span>}
        </>
      ) : (
        <svg width="38" height="46" viewBox="0 0 40 48" fill="none" stroke="currentColor" strokeWidth="2" className="text-ink-4" aria-hidden>
          <path d="M6 2h20l10 10v34H6z" />
          <path d="M26 2v10h10" />
          <path d="M12 24h16M12 31h16M12 38h10" />
        </svg>
      )}
    </div>
  );
}
