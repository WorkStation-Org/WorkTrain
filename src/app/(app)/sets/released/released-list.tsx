"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { SetCover } from "@/components/set-cover";
import { Badge, type BadgeTone } from "@/components/ui";

/**
 * การ์ดชุดที่ปล่อยแล้ว — แท็บกรอง + ค้นหาชื่อ · แต่ละการ์ด: ปก · เวอร์ชัน · วันที่ปล่อย · เนื้อหา · แถบสถานะผู้ได้รับมอบ
 * ข้อมูลจัดรูปบนเซิร์ฟเวอร์แล้ว (วันที่เป็นข้อความ) — ที่นี่แค่กรองและแสดง
 */

export type ReleasedFilter = "active" | "overdue" | "complete" | "closed";

export interface ReleasedCard {
  href: string;
  title: string;
  kindName: string;
  badge: { tone: BadgeTone; label: string };
  /** ป้ายเพิ่ม เช่น "เวอร์ชันใหม่รออนุมัติ" */
  note: { tone: BadgeTone; label: string } | null;
  meta: string;
  contents: string;
  videoChip: string | null;
  coverUrl: string | null;
  hasVideo: boolean;
  learners: number;
  passed: number;
  started: number;
  notStarted: number;
  overdue: number;
  groups: ReleasedFilter[];
}

const TABS: { key: "all" | ReleasedFilter; label: string }[] = [
  { key: "all", label: "ทั้งหมด" },
  { key: "active", label: "ใช้อยู่" },
  { key: "overdue", label: "มีคนเลยกำหนด" },
  { key: "complete", label: "ผ่านครบแล้ว" },
  { key: "closed", label: "ปิดแล้ว" },
];

const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0);

export function ReleasedList({ cards }: { cards: ReleasedCard[] }) {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("all");
  const [q, setQ] = useState("");
  const counts = useMemo(
    () => Object.fromEntries(TABS.map((t) => [t.key, t.key === "all" ? cards.length : cards.filter((c) => c.groups.includes(t.key as ReleasedFilter)).length])),
    [cards],
  );
  const needle = q.trim().toLowerCase();
  const shown = cards.filter((c) => (tab === "all" || c.groups.includes(tab)) && (!needle || c.title.toLowerCase().includes(needle)));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="กรองชุด" className="flex flex-wrap gap-1 rounded-xl bg-subtle p-1">
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
            placeholder="ค้นหาชื่อชุด"
            className="min-w-0 flex-1 bg-transparent text-[14px] text-fg outline-none placeholder:text-muted"
          />
        </label>
      </div>

      {shown.length === 0 ? (
        <p className="rounded-[13px] border border-dashed border-line-strong px-4 py-10 text-center text-[13px] text-muted">
          {needle ? `ไม่พบชุดที่ชื่อมี “${q.trim()}”` : "ไม่มีชุดในหมวดนี้"}
        </p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
          {shown.map((c) => (
            <li key={c.href}>
              <Link
                href={c.href}
                className="flex h-full flex-col overflow-hidden rounded-[13px] border border-line bg-raised transition-colors hover:border-line-strong focus-visible:outline-2 focus-visible:outline-fg"
              >
                <SetCover coverUrl={c.coverUrl} hasVideo={c.hasVideo} kindName={c.kindName} videoChip={c.videoChip} />
                <div className="flex flex-1 flex-col gap-2 px-4 pb-4 pt-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[15px] font-semibold leading-snug text-fg">{c.title}</span>
                    <span className="shrink-0">
                      <Badge tone={c.badge.tone} label={c.badge.label} />
                    </span>
                  </div>
                  <span className="text-[12px] text-muted">{c.meta}</span>
                  <span className="text-[12px] text-muted">{c.contents}</span>
                  {c.note && (
                    <span>
                      <Badge tone={c.note.tone} label={c.note.label} />
                    </span>
                  )}
                  <div className="mt-auto pt-1">
                    {c.learners === 0 ? (
                      <p className="rounded-lg bg-subtle px-3 py-2 text-[12px] text-muted">ยังไม่มีผู้ได้รับมอบ</p>
                    ) : (
                      <Learners card={c} />
                    )}
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

/** แถบผู้ได้รับมอบ — ผ่าน · กำลังเรียน · ยังไม่เริ่ม · เลยกำหนด เรียงกันตามสัดส่วน */
function Learners({ card: c }: { card: ReleasedCard }) {
  const parts = [
    { n: c.passed, cls: "bg-success", label: "ผ่าน" },
    { n: c.started, cls: "bg-fg", label: "กำลังเรียน" },
    { n: c.notStarted, cls: "bg-line-strong", label: "ยังไม่เริ่ม" },
    { n: c.overdue, cls: "bg-danger", label: "เลยกำหนด" },
  ];
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2 text-[12px]">
        <span className="text-fg">
          ผ่าน <span className="font-semibold">{c.passed}</span>/{c.learners} คน · {pct(c.passed, c.learners)}%
        </span>
        {c.overdue > 0 && <span className="font-semibold text-danger">เลยกำหนด {c.overdue}</span>}
      </div>
      <span className="flex h-1.5 overflow-hidden rounded-full bg-subtle" role="img" aria-label={parts.map((p) => `${p.label} ${p.n}`).join(" · ")}>
        {parts.map((p) => (p.n ? <span key={p.label} className={`h-full ${p.cls}`} style={{ width: `${(p.n / c.learners) * 100}%` }} /> : null))}
      </span>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted" aria-hidden>
        {parts.map((p) => (
          <li key={p.label} className="flex items-center gap-1.5">
            <span className={`size-2 rounded-full ${p.cls}`} />
            {p.label} {p.n}
          </li>
        ))}
      </ul>
    </div>
  );
}
