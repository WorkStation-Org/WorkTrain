"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui";
import type { AudienceKind } from "@/db/schema";
import { audienceOptions, resolveAudience } from "@/domain/audience";
import { saveAudienceAction } from "../actions";

/**
 * ผู้รับ (spec §5) — ค้นหา + แท็บตามชนิดเงื่อนไข · ชิปของที่เลือก · รายชื่อคำนวณสดตามที่ติ๊ก (ไม่ต้องบันทึกก่อน)
 * ชุดที่ใช้อยู่: สรุปก่อนบันทึกว่าใครจะได้รับมอบเพิ่ม (มอบทันที) และใครไม่ตรงเงื่อนไขแล้ว (เก็บการมอบเดิมไว้)
 */

export interface AudiencePerson {
  personId: number;
  fullName: string;
  nickname: string | null;
  title: string | null;
  teamName: string | null;
  positionId: number | null;
  teamId: number | null;
  managedTeamIds: number[];
}

type Kind = Extract<AudienceKind, "position" | "team" | "manages_team" | "person">;
interface Rule {
  kind: AudienceKind;
  refId: number;
  label: string;
}

const TABS: { kind: Kind; label: string }[] = [
  { kind: "position", label: "ตำแหน่ง" },
  { kind: "team", label: "ทีม / สาขา" },
  { kind: "manages_team", label: "หัวหน้าทีม" },
  { kind: "person", label: "รายคน" },
];
const KIND_LABEL: Record<AudienceKind, string> = { position: "ตำแหน่ง", team: "ทีม", manages_team: "หัวหน้า", person: "คน", adhoc_group: "กลุ่ม" };
const keyOf = (r: { kind: string; refId: number }) => `${r.kind}:${r.refId}`;

export function AudiencePicker({
  setId,
  people,
  initialRules,
  editable,
  active,
  assignedIds,
}: {
  setId: number;
  people: AudiencePerson[];
  initialRules: Rule[];
  editable: boolean;
  /** ชุดที่ใช้อยู่ — สรุปก่อนบันทึก และมอบทันทีหลังบันทึก */
  active: boolean;
  assignedIds: number[];
}) {
  const router = useRouter();
  const [rules, setRules] = useState<Rule[]>(initialRules);
  const [tab, setTab] = useState<Kind>("position");
  const [q, setQ] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const options = useMemo(() => audienceOptions(people), [people]);
  const chosen = useMemo(() => resolveAudience(people, rules), [people, rules]);
  const before = useMemo(() => resolveAudience(people, initialRules), [people, initialRules]);
  const chosenIds = useMemo(() => new Set(chosen.map((p) => p.personId)), [chosen]);
  const assigned = useMemo(() => new Set(assignedIds), [assignedIds]);
  const dirty = rules.map(keyOf).sort().join() !== initialRules.map(keyOf).sort().join();
  const picked = new Set(rules.map(keyOf));

  const added = chosen.filter((p) => !assigned.has(p.personId));
  const leaving = before.filter((p) => !chosenIds.has(p.personId) && assigned.has(p.personId));

  function toggle(r: Rule) {
    setMsg(null);
    setConfirming(false);
    setRules((rs) => (rs.some((x) => keyOf(x) === keyOf(r)) ? rs.filter((x) => keyOf(x) !== keyOf(r)) : [...rs, r]));
  }

  const needle = q.trim().toLowerCase();
  const raw: (Rule & { sub: string })[] =
    tab === "position"
      ? options.positions.map((p) => ({ kind: "position", refId: p.id, label: p.label, sub: `${p.count} คน` }))
      : tab === "team"
        ? options.teams.map((t) => ({ kind: "team", refId: t.id, label: t.label, sub: `${t.count} คน` }))
        : tab === "manages_team"
          ? options.teams
              .filter((t) => options.managersByTeam.has(t.id))
              .map((t) => ({ kind: "manages_team", refId: t.id, label: `หัวหน้า ${t.label}`, sub: `${options.managersByTeam.get(t.id)} คน` }))
          : people.map((p) => ({
              kind: "person",
              refId: p.personId,
              label: p.fullName,
              sub: [p.nickname && `(${p.nickname})`, p.title, p.teamName].filter(Boolean).join(" · ") || "—",
            }));
  const list = raw.filter((o) => !needle || `${o.label} ${o.sub}`.toLowerCase().includes(needle)).slice(0, tab === "person" ? 40 : 200);

  const groups = useMemo(() => {
    const m = new Map<string, AudiencePerson[]>();
    for (const p of chosen) m.set(p.teamName ?? "ไม่มีทีม", [...(m.get(p.teamName ?? "ไม่มีทีม") ?? []), p]);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], "th"));
  }, [chosen]);

  async function save() {
    setBusy(true);
    const out = await saveAudienceAction({ setId, rules: rules.map((r) => ({ kind: r.kind, refId: r.refId, label: r.label })) }).catch(() => null);
    setBusy(false);
    setConfirming(false);
    if (!out?.ok) return setMsg({ ok: false, text: out?.error ?? "บันทึกไม่สำเร็จ" });
    setMsg({ ok: true, text: active ? `บันทึกผู้รับแล้ว · มอบให้ ${out.assigned} คนเพิ่ม` : "บันทึกผู้รับแล้ว" });
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-start gap-4">
      <section aria-label="เลือกเงื่อนไข" className="min-w-0 flex-[999_1_520px] overflow-hidden rounded-[13px] border border-line bg-raised">
        <div className="space-y-3 border-b border-line p-4">
          {editable && (
            <>
              <label className="flex min-h-11 items-center gap-2 rounded-[10px] border border-line-strong bg-canvas px-3">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0 text-muted" aria-hidden>
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
                <span className="sr-only">ค้นหา</span>
                <input
                  type="search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={`ค้นหา${TABS.find((t) => t.kind === tab)?.label} เช่น “sales” “บางนา”`}
                  className="min-w-0 flex-1 bg-transparent text-[14px] text-fg outline-none placeholder:text-muted"
                />
              </label>
              <div role="tablist" aria-label="ชนิดเงื่อนไข" className="flex flex-wrap gap-1 self-start rounded-[10px] bg-subtle p-1">
                {TABS.map((t) => {
                  const n = rules.filter((r) => r.kind === t.kind).length;
                  return (
                    <button
                      key={t.kind}
                      type="button"
                      role="tab"
                      aria-selected={tab === t.kind}
                      onClick={() => setTab(t.kind)}
                      className={`min-h-9 rounded-lg px-3.5 text-[13px] ${tab === t.kind ? "bg-raised font-semibold text-fg shadow-sm" : "text-ink-2 hover:text-fg"}`}
                    >
                      {t.label}
                      {n > 0 && <span className="font-normal text-muted"> · {n}</span>}
                    </button>
                  );
                })}
              </div>
            </>
          )}
          <div className="flex min-h-8 flex-wrap items-center gap-1.5">
            <span className="text-[12px] text-muted">เลือกแล้ว:</span>
            {rules.length === 0 && <span className="text-[12px] text-ink-4">ยังไม่ได้เลือก</span>}
            {rules.map((r) => (
              <span key={keyOf(r)} className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-fg pl-3 pr-1 text-[12px] text-canvas">
                <span className="opacity-70">{KIND_LABEL[r.kind]}</span> {r.label}
                {editable ? (
                  <button type="button" onClick={() => toggle(r)} aria-label={`เอา ${r.label} ออก`} className="flex size-6 items-center justify-center rounded-full hover:bg-white/15">
                    ×
                  </button>
                ) : (
                  <span className="w-2" />
                )}
              </span>
            ))}
          </div>
        </div>

        {editable && (
          <>
            {tab === "position" && options.peopleWithoutPosition > 0 && (
              <p className="px-4 pt-3 text-[12px] text-warn">
                {options.peopleWithoutPosition} คนยังไม่มีรหัสตำแหน่งใน WorkID — จะไม่ติดเงื่อนไขตำแหน่งจนกว่า WorkHR จะเติมให้ (เลือกตามทีมหรือรายคนแทนได้)
              </p>
            )}
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-1 p-2">
              {list.map((o) => {
                const on = picked.has(keyOf(o));
                const members = resolveAudience(people, [o]);
                const fresh = members.filter((p) => !chosenIds.has(p.personId)).length;
                return (
                  <li key={keyOf(o)}>
                    <label className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-[10px] px-3 py-2 ${on ? "bg-subtle ring-1 ring-fg" : "hover:bg-canvas"}`}>
                      <input type="checkbox" checked={on} onChange={() => toggle(o)} className="size-[18px] accent-[var(--color-fg)]" />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-[14px] font-semibold text-fg">{o.label}</span>
                        <span className="truncate text-[12px] text-muted">{o.sub}</span>
                      </span>
                      <span className={`shrink-0 text-[12px] font-semibold ${on ? "text-fg" : fresh ? "text-success" : "text-ink-4"}`}>
                        {on ? "เลือกแล้ว" : fresh ? `+${fresh} คน` : "อยู่ในรายชื่อแล้ว"}
                      </span>
                    </label>
                  </li>
                );
              })}
              {list.length === 0 && <li className="col-span-full px-3 py-6 text-center text-[13px] text-muted">ไม่พบ “{q.trim()}”</li>}
            </ul>
          </>
        )}
      </section>

      <aside aria-label="คนที่จะได้รับมอบ" className="min-w-0 flex-[1_1_320px] overflow-hidden rounded-[13px] border border-line bg-raised">
        <div className="space-y-1 border-b border-line p-4">
          <span className="text-[12px] text-muted">{dirty ? "คนที่จะได้รับมอบ (คำนวณสดตามที่ติ๊ก)" : "คนที่ตรงเงื่อนไขตอนนี้"}</span>
          <p className="text-[28px] font-bold leading-tight text-fg">{chosen.length} คน</p>
          <p className="text-[12px] text-muted">{groups.length ? `จาก ${groups.length} ทีม` : "ติ๊กเงื่อนไขเพื่อดูรายชื่อ"}</p>
        </div>
        <div className="max-h-[520px] overflow-auto px-2.5 py-1.5">
          {groups.map(([team, list]) => (
            <div key={team}>
              <div className="flex justify-between px-1.5 pb-1 pt-2 text-[12px] font-semibold text-ink-2">
                <span>{team}</span>
                <span className="font-normal text-muted">{list.length} คน</span>
              </div>
              <ul>
                {list.map((p) => (
                  <li key={p.personId} className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-subtle text-[12px] font-semibold">{p.fullName.slice(0, 1)}</span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[13px] font-semibold text-fg">{p.fullName}</span>
                      <span className="truncate text-[11px] text-muted">{p.title ?? "ยังไม่มีรหัสตำแหน่ง"}</span>
                    </span>
                    {active && !assigned.has(p.personId) && <span className="shrink-0 text-[11px] font-semibold text-success">ใหม่</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        {editable && (
          <div className="space-y-2 border-t border-line p-4">
            {confirming && active ? (
              <div className="space-y-2.5">
                <div className="rounded-[10px] bg-success-soft px-3 py-2.5 text-[13px]">
                  <strong className="text-success">+ {added.length} คนได้รับมอบทันที</strong>
                  <p className="mt-1 text-ink-2">{added.slice(0, 12).map((p) => p.fullName).join(" · ") || "ไม่มีคนใหม่"}{added.length > 12 ? ` และอีก ${added.length - 12} คน` : ""}</p>
                  <p className="mt-1 text-[12px] text-muted">กำหนดส่งนับจากวันนี้ · แจ้งทาง LINE เหมือนตอนอนุมัติ</p>
                </div>
                {leaving.length > 0 && (
                  <div className="rounded-[10px] bg-warn-soft px-3 py-2.5 text-[13px]">
                    <strong className="text-warn">{leaving.length} คนไม่ตรงเงื่อนไขแล้ว — เก็บการมอบเดิมไว้</strong>
                    <p className="mt-1 text-ink-2">{leaving.slice(0, 12).map((p) => p.fullName).join(" · ")}</p>
                    <p className="mt-1 text-[12px] text-muted">ยังเรียนต่อได้ · ผลสอบเดิมยังนับ</p>
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="primary" onClick={save} disabled={busy}>
                    {busy ? "กำลังบันทึก…" : added.length ? `บันทึก และมอบให้ ${added.length} คน` : "บันทึก"}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
                    กลับไปแก้
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="primary" disabled={!dirty || busy} onClick={() => (active ? setConfirming(true) : save())}>
                  {busy ? "กำลังบันทึก…" : active ? "ตรวจก่อนบันทึก" : "บันทึกผู้รับ"}
                </Button>
                {dirty && <span className="text-[12px] text-warn">ยังไม่ได้บันทึก</span>}
              </div>
            )}
            {msg && <p className={`text-[12px] ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</p>}
          </div>
        )}
      </aside>
    </div>
  );
}
