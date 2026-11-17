"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { SetCover } from "@/components/set-cover";
import { Badge, Icon, type BadgeTone } from "@/components/ui";
import { EndSetButton } from "./end-set-button";

/**
 * รายการชุดการเรียนรู้หน้าเดียว (`/sets`) — สลับดูได้สองแบบ: การ์ดปกคลิป (ค่าเริ่มต้น) · ตาราง
 * แท็บกรองและช่องค้นหาใช้ร่วมกันทั้งสองแบบ · แบบที่เลือกอยู่ใน URL (`?view=table`) ส่งลิงก์ต่อได้ รีเฟรชแล้วไม่หาย
 * ข้อมูลจัดรูปบนเซิร์ฟเวอร์แล้ว (วันที่เป็นข้อความ) — ที่นี่แค่กรองและแสดง
 */

export type SetFilter = "pending" | "draft" | "active" | "overdue" | "closed";
export type SetView = "cards" | "table";

export interface SetItem {
  id: number;
  href: string;
  title: string;
  kindName: string;
  badge: { tone: BadgeTone; label: string };
  /** ป้ายเพิ่ม เช่น "เวอร์ชันใหม่รออนุมัติ" */
  note: { tone: BadgeTone; label: string } | null;
  /** รอใครอนุมัติ กี่วัน — งานที่ต้องตามต่อ */
  waitNote: string | null;
  /** เวอร์ชัน · วันที่ปล่อย/ปิด · ผู้สร้าง */
  meta: string;
  contents: string;
  videoChip: string | null;
  coverUrl: string | null;
  hasVideo: boolean;
  released: boolean;
  learners: number;
  passed: number;
  started: number;
  notStarted: number;
  overdue: number;
  authorName: string;
  approverName: string | null;
  updatedLabel: string;
  canDelete: boolean;
  groups: SetFilter[];
}

const TABS: { key: "all" | SetFilter; label: string }[] = [
  { key: "all", label: "ทั้งหมด" },
  { key: "pending", label: "รออนุมัติ" },
  { key: "draft", label: "ร่าง" },
  { key: "active", label: "ใช้อยู่" },
  { key: "overdue", label: "มีคนเลยกำหนด" },
  { key: "closed", label: "ปิดแล้ว" },
];

const VIEWS: { key: SetView; label: string; icon: "grid" | "clipboard" }[] = [
  { key: "cards", label: "การ์ด", icon: "grid" },
  { key: "table", label: "ตาราง", icon: "clipboard" },
];

const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0);

export function SetBrowser({ items, initialView }: { items: SetItem[]; initialView: SetView }) {
  const [view, setView] = useState<SetView>(initialView);
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("all");
  const [q, setQ] = useState("");
  const counts = useMemo(
    () => Object.fromEntries(TABS.map((t) => [t.key, t.key === "all" ? items.length : items.filter((c) => c.groups.includes(t.key as SetFilter)).length])),
    [items],
  );
  const needle = q.trim().toLowerCase();
  const shown = items.filter((c) => (tab === "all" || c.groups.includes(tab)) && (!needle || c.title.toLowerCase().includes(needle)));
  // แท็บที่ไม่มีชุดเลยไม่ต้องแสดง (ยกเว้น "ทั้งหมด" และแท็บที่เลือกอยู่)
  const tabs = TABS.filter((t) => t.key === "all" || t.key === tab || counts[t.key] > 0);

  function pickView(v: SetView) {
    setView(v);
    // เก็บใน URL โดยไม่โหลดหน้าใหม่ — ค่าเริ่มต้น (การ์ด) ไม่ต้องมี ?view
    const url = new URL(window.location.href);
    if (v === "cards") url.searchParams.delete("view");
    else url.searchParams.set("view", v);
    window.history.replaceState(null, "", url);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label="กรองชุด" className="flex flex-wrap gap-1 rounded-xl bg-subtle p-1">
          {tabs.map((t) => (
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
        <label className="flex h-11 min-w-0 flex-[1_1_220px] items-center gap-2 rounded-[10px] border border-line-strong bg-raised px-3 sm:max-w-[300px]">
          <Icon name="search" size={16} className="shrink-0 text-muted" />
          <span className="sr-only">ค้นหาชุด</span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ค้นหาชื่อชุด"
            className="min-w-0 flex-1 bg-transparent text-[14px] text-fg outline-none placeholder:text-muted"
          />
        </label>
        <div role="group" aria-label="รูปแบบการแสดง" className="ml-auto flex gap-1 rounded-xl bg-subtle p-1">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              aria-pressed={view === v.key}
              onClick={() => pickView(v.key)}
              className={`flex min-h-9 items-center gap-1.5 rounded-[9px] px-3 text-[13px] ${view === v.key ? "bg-raised font-semibold text-fg shadow-sm" : "text-ink-2 hover:text-fg"}`}
            >
              <Icon name={v.icon} size={15} />
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="rounded-[13px] border border-dashed border-line-strong px-4 py-10 text-center text-[13px] text-muted">
          {needle ? `ไม่พบชุดที่ชื่อมี “${q.trim()}”` : "ไม่มีชุดในหมวดนี้"}
        </p>
      ) : view === "cards" ? (
        <Cards items={shown} />
      ) : (
        <Table items={shown} />
      )}
    </div>
  );
}

function Cards({ items }: { items: SetItem[] }) {
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
      {items.map((c) => (
        <li key={c.id}>
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
                {c.waitNote ? (
                  <p className="rounded-lg bg-warn-soft px-3 py-2 text-[12px] font-semibold text-warn">{c.waitNote}</p>
                ) : !c.released ? (
                  <p className="rounded-lg bg-subtle px-3 py-2 text-[12px] text-muted">ยังไม่ปล่อย · ผู้อนุมัติ {c.approverName ?? "ยังไม่ได้เลือก"}</p>
                ) : c.learners === 0 ? (
                  <p className="rounded-lg bg-subtle px-3 py-2 text-[12px] text-muted">ยังไม่มีผู้ได้รับมอบ</p>
                ) : (
                  <Learners item={c} />
                )}
              </div>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** แถบผู้ได้รับมอบ — ผ่าน · กำลังเรียน · ยังไม่เริ่ม · เลยกำหนด เรียงกันตามสัดส่วน */
function Learners({ item: c }: { item: SetItem }) {
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

function Table({ items }: { items: SetItem[] }) {
  const th = "px-3 py-2.5 text-left text-[12px] font-semibold text-ink-2 whitespace-nowrap";
  const td = "px-3 py-3 align-top";
  return (
    <div className="thin-scroll overflow-x-auto rounded-[13px] border border-line bg-raised">
      <table className="w-full min-w-[880px] border-collapse text-[13px]">
        <thead className="bg-subtle">
          <tr>
            <th scope="col" className={th}>ชุด</th>
            <th scope="col" className={th}>สถานะ</th>
            <th scope="col" className={th}>เนื้อหา</th>
            <th scope="col" className={`${th} text-right`}>ผ่าน</th>
            <th scope="col" className={`${th} text-right`}>เลยกำหนด</th>
            <th scope="col" className={th}>ผู้สร้าง · ผู้อนุมัติ</th>
            <th scope="col" className={th}>แก้ล่าสุด</th>
            <th scope="col" className={th}>
              <span className="sr-only">จัดการ</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((c) => (
            <tr key={c.id} className="border-t border-line hover:bg-subtle/60">
              <td className={`${td} min-w-[220px]`}>
                <Link href={c.href} className="font-semibold text-fg hover:underline">
                  {c.title}
                </Link>
                <span className="mt-0.5 block text-[12px] text-muted">
                  {c.kindName} · {c.meta}
                </span>
              </td>
              <td className={td}>
                <span className="flex flex-col items-start gap-1">
                  <Badge tone={c.badge.tone} label={c.badge.label} />
                  {c.note && <Badge tone={c.note.tone} label={c.note.label} />}
                  {c.waitNote && <span className="text-[12px] font-semibold text-warn">{c.waitNote}</span>}
                </span>
              </td>
              <td className={`${td} text-ink-2`}>{c.contents}</td>
              <td className={`${td} whitespace-nowrap text-right`}>
                {c.released && c.learners > 0 ? (
                  <>
                    <span className="font-semibold text-fg">
                      {c.passed}/{c.learners}
                    </span>
                    <span className="block text-[12px] text-muted">{pct(c.passed, c.learners)}%</span>
                  </>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </td>
              <td className={`${td} text-right`}>{c.overdue > 0 ? <span className="font-semibold text-danger">{c.overdue}</span> : <span className="text-muted">—</span>}</td>
              <td className={`${td} text-ink-2`}>
                {c.authorName}
                <span className="block text-[12px] text-muted">{c.approverName ?? "ยังไม่ได้เลือกผู้อนุมัติ"}</span>
              </td>
              <td className={`${td} whitespace-nowrap text-ink-2`}>{c.updatedLabel}</td>
              <td className={`${td} text-right`}>{c.canDelete && <EndSetButton setId={c.id} title={c.title} mode="delete" />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
