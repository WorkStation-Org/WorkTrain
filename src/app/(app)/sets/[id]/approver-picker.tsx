"use client";

import { useId, useMemo, useState } from "react";

/**
 * ผู้อนุมัติแบบค้นหาได้ — พิมพ์ชื่อ ชื่อเล่น ตำแหน่ง หรือทีม · หัวหน้าของผู้สร้างขึ้นเป็นข้อแนะนำ (ADR-0004)
 * ส่งค่าในฟอร์มตั้งค่าผ่าน hidden input `approverPersonId`
 */

export interface PickPerson {
  personId: number;
  fullName: string;
  nickname: string | null;
  title: string | null;
  teamName: string | null;
}

export function ApproverPicker({
  people,
  initialId,
  managerId,
  suggestedIds = [],
}: {
  people: PickPerson[];
  initialId: number | null;
  /** หัวหน้าของผู้สร้าง — ขึ้นบนสุดพร้อมป้าย */
  managerId: number | null;
  suggestedIds?: number[];
}) {
  const [picked, setPicked] = useState<number | null>(initialId);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const byId = useMemo(() => new Map(people.map((p) => [p.personId, p])), [people]);
  const current = picked !== null ? byId.get(picked) : undefined;

  const needle = q.trim().toLowerCase();
  const results = useMemo(() => {
    if (!needle) {
      const ids = [managerId, ...suggestedIds].filter((x, i, a): x is number => x !== null && a.indexOf(x) === i);
      return ids.flatMap((id) => byId.get(id) ?? []);
    }
    return people.filter((p) => [p.fullName, p.nickname, p.title, p.teamName].some((v) => v?.toLowerCase().includes(needle))).slice(0, 8);
  }, [needle, people, managerId, suggestedIds, byId]);

  function choose(p: PickPerson) {
    setPicked(p.personId);
    setQ("");
    setActive(0);
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && results[active]) {
      e.preventDefault();
      choose(results[active]);
    } else if (e.key === "Escape" && current) {
      setPicked(current.personId);
    }
  }

  return (
    <div className="space-y-2">
      <input type="hidden" name="approverPersonId" value={picked ?? ""} />
      {current ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-fg px-3.5 py-2.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-fg font-bold text-canvas">{current.fullName.slice(0, 1)}</span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-[14px] font-semibold text-fg">
              {current.fullName}
              {current.nickname ? <span className="font-normal text-muted"> ({current.nickname})</span> : null}
            </span>
            <span className="text-[12px] text-muted">{[current.title, current.teamName].filter(Boolean).join(" · ") || "—"}</span>
          </span>
          {current.personId === managerId && <span className="rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-semibold text-success">หัวหน้าของคุณ</span>}
          <button type="button" onClick={() => setPicked(null)} className="min-h-9 rounded-lg border border-line-strong px-3 text-[13px] hover:bg-subtle">
            เปลี่ยน
          </button>
        </div>
      ) : (
        <div className="space-y-1.5">
          <label className="flex min-h-11 items-center gap-2 rounded-[10px] border-2 border-fg bg-raised px-3">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0 text-muted" aria-hidden>
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <span className="sr-only">ค้นหาผู้อนุมัติ</span>
            <input
              type="search"
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-activedescendant={results[active] ? `${listId}-${results[active].personId}` : undefined}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKey}
              placeholder="พิมพ์ชื่อ ชื่อเล่น ตำแหน่ง หรือทีม"
              className="min-w-0 flex-1 bg-transparent text-[14px] text-fg outline-none placeholder:text-muted"
            />
          </label>
          <div id={listId} role="listbox" aria-label="ผลการค้นหา" className="overflow-hidden rounded-xl border border-line bg-raised">
            {!needle && results.length > 0 && <div className="px-3.5 pb-1 pt-2 text-[11px] tracking-wide text-muted">แนะนำ</div>}
            {results.map((p, i) => (
              <button
                key={p.personId}
                id={`${listId}-${p.personId}`}
                type="button"
                role="option"
                aria-selected={i === active}
                onClick={() => choose(p)}
                onMouseEnter={() => setActive(i)}
                className={`flex min-h-14 w-full items-center gap-3 border-b border-line px-3.5 py-2 text-left last:border-b-0 ${i === active ? "bg-subtle" : ""}`}
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-subtle text-[13px] font-semibold">{p.fullName.slice(0, 1)}</span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[14px] font-semibold text-fg">
                    {p.fullName}
                    {p.nickname ? <span className="font-normal text-muted"> ({p.nickname})</span> : null}
                  </span>
                  <span className="text-[12px] text-muted">{[p.title, p.teamName].filter(Boolean).join(" · ") || "—"}</span>
                </span>
                {p.personId === managerId && <span className="rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-semibold text-success">หัวหน้าของคุณ</span>}
              </button>
            ))}
            {needle && results.length === 0 && <p className="px-3.5 py-4 text-[13px] text-muted">ไม่พบ “{q.trim()}” — ลองพิมพ์ชื่อเล่นหรือชื่อทีม</p>}
            <p className="bg-canvas px-3.5 py-2 text-[12px] text-muted">
              {needle ? `พบ ${results.length} คน (แสดงไม่เกิน 8)` : `พิมพ์เพื่อค้นจาก ${people.length} คนในผังองค์กร`} · ลูกศรขึ้น/ลง แล้ว Enter เลือกได้
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
