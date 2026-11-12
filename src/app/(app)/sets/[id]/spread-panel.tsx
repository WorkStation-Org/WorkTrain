"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { SpreadMode } from "@/db/schema";
import { spreadPlan } from "@/domain/spread";
import { setSpreadModeAction } from "../actions";

/**
 * เฉลี่ยข้อสอบตาม — ไฟล์ (เท่ากันทุกไฟล์) · หัวข้อ (ตาม blueprint ของชนิดชุด) · กำหนดเอง (น้ำหนักต่อไฟล์ในแผงเอกสาร)
 * ตารางแผนคำนวณด้วย `spreadPlan` ตัวเดียวกับที่ส่งให้ AI · หลัง AI ออกแล้วแสดงว่าแต่ละชุดมาจากไฟล์ไหนกี่ข้อ
 */

const MODES: { key: SpreadMode; label: string }[] = [
  { key: "file", label: "ไฟล์ (เท่ากันทุกไฟล์)" },
  { key: "topic", label: "หัวข้อ" },
  { key: "custom", label: "กำหนดเอง" },
];

export function SpreadPanel({
  setId,
  mode: initialMode,
  files,
  topics,
  perForm,
  formCount,
  editable,
  coverage,
}: {
  setId: number;
  mode: SpreadMode;
  files: { name: string; weight: number }[];
  topics: string[];
  perForm: number;
  formCount: number;
  editable: boolean;
  /** `[ชุด][ไฟล์]` จาก `source_ref` ของข้อสอบที่มีอยู่ · null = ยังไม่ออก */
  coverage: { counts: number[][]; unknown: number[] } | null;
}) {
  const router = useRouter();
  const [mode, setMode] = useState(initialMode);
  const [busy, setBusy] = useState(false);
  const usePlan = mode !== "topic" && files.length >= 2;
  const plan = usePlan ? spreadPlan(mode === "custom" ? files.map((f) => f.weight) : files.map(() => 1), perForm, formCount) : null;
  const totals = plan ? files.map((_, i) => plan.reduce((n, f) => n + f[i], 0)) : [];
  const max = Math.max(1, ...totals);

  async function pick(next: SpreadMode) {
    if (!editable || next === mode) return;
    const prev = mode;
    setMode(next);
    setBusy(true);
    const out = await setSpreadModeAction({ setId, mode: next }).catch(() => null);
    setBusy(false);
    if (!out?.ok) setMode(prev);
    else router.refresh();
  }

  const explain =
    files.length < 2
      ? "มี PDF ไฟล์เดียว — AI ออกจากไฟล์นี้ทั้งหมดตามสัดส่วนหัวข้อ"
      : mode === "topic"
        ? `AI กระจายเองตามหัวข้อของชนิดชุด${topics.length ? ` (${topics.join(" · ")})` : ""} — ไม่บังคับจำนวนต่อไฟล์`
        : mode === "custom"
          ? "แบ่งตามน้ำหนักของแต่ละไฟล์ (ตั้งในแผงเอกสาร: ไฟล์สำคัญ 2 · ไม่ต้องออก 0) แล้วแจกให้ทุกชุดได้ครบพอดี"
          : `${files.length} ไฟล์ · ชุดละ ${perForm} ข้อ → ทุกไฟล์ได้จำนวนข้อเท่า ๆ กัน ไม่ว่าไฟล์จะหนาแค่ไหน`;

  return (
    <section className="space-y-3 rounded-[13px] border border-line bg-raised p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-[15px] font-semibold text-fg">เฉลี่ยข้อสอบตาม</h3>
        <div role="radiogroup" aria-label="วิธีเฉลี่ย" className="flex flex-wrap gap-1 rounded-[10px] bg-subtle p-1">
          {MODES.map((m) => (
            <button
              key={m.key}
              type="button"
              role="radio"
              aria-checked={mode === m.key}
              disabled={!editable || busy}
              onClick={() => pick(m.key)}
              className={`min-h-9 rounded-lg px-3.5 text-[13px] disabled:cursor-default ${mode === m.key ? "bg-raised font-semibold text-fg shadow-sm" : "text-ink-2 enabled:hover:text-fg"}`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <p className="rounded-[10px] bg-canvas px-3.5 py-2.5 text-[13px] leading-relaxed text-ink-2">{explain}</p>

      {plan && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-[13px]">
            <thead>
              <tr className="text-left text-[12px] text-muted">
                <th scope="col" className="border-b border-line px-2 py-2 font-medium">
                  ไฟล์
                </th>
                <th scope="col" className="border-b border-line px-2 py-2 text-right font-medium">
                  ข้อต่อชุด
                </th>
                <th scope="col" className="border-b border-line px-2 py-2 text-right font-medium">
                  รวม {formCount} ชุด
                </th>
                <th scope="col" className="w-1/3 border-b border-line px-2 py-2 font-medium">
                  สัดส่วน
                </th>
              </tr>
            </thead>
            <tbody>
              {files.map((f, i) => {
                const per = plan.map((row) => row[i]);
                const lo = Math.min(...per);
                const hi = Math.max(...per);
                return (
                  <tr key={f.name + i}>
                    <td className="border-b border-subtle px-2 py-2 font-semibold">{f.name}</td>
                    <td className="border-b border-subtle px-2 py-2 text-right font-semibold">{lo === hi ? lo : `${lo}–${hi}`}</td>
                    <td className="border-b border-subtle px-2 py-2 text-right">{totals[i]}</td>
                    <td className="border-b border-subtle px-2 py-2">
                      <span className="block h-2 overflow-hidden rounded-full bg-subtle">
                        <span className="block h-full rounded-full bg-fg" style={{ width: `${(totals[i] / max) * 100}%` }} />
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {coverage && plan && (
        <div className="space-y-2 border-t border-line pt-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h4 className="text-[14px] font-semibold text-fg">ตรวจหลัง AI ออก — แต่ละชุดมาจากไฟล์ไหนกี่ข้อ</h4>
            <span className="text-[12px] text-muted">นับจาก “ที่มา” ของแต่ละข้อ · สีส้ม = ไม่ตรงแผน (แก้ที่มาหรือให้ AI ออกข้อนั้นใหม่)</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-center text-[13px]">
              <thead>
                <tr className="text-[12px] text-muted">
                  <th scope="col" className="border-b border-line px-2 py-1.5 text-left font-medium">
                    ไฟล์
                  </th>
                  {coverage.counts.map((_, f) => (
                    <th key={f} scope="col" className="border-b border-line px-2 py-1.5 font-medium">
                      ชุด {f + 1}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {files.map((file, i) => (
                  <tr key={file.name + i}>
                    <td className="border-b border-subtle px-2 py-1 text-left">{file.name}</td>
                    {coverage.counts.map((row, f) => {
                      const n = row[i] ?? 0;
                      const want = plan[f]?.[i] ?? 0;
                      return (
                        <td key={f} className="border-b border-subtle p-1">
                          <span
                            className={`inline-flex h-7 min-w-8 items-center justify-center rounded-md font-semibold ${n !== want ? "bg-warn-soft text-warn" : n ? "bg-success-soft text-success" : "bg-canvas text-ink-4"}`}
                            title={n !== want ? `แผน ${want} ข้อ` : undefined}
                          >
                            {n}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {coverage.unknown.some((n) => n > 0) && (
                  <tr>
                    <td className="px-2 py-1 text-left text-muted">ระบุไฟล์ไม่ได้</td>
                    {coverage.unknown.map((n, f) => (
                      <td key={f} className="p-1">
                        <span className={`inline-flex h-7 min-w-8 items-center justify-center rounded-md font-semibold ${n ? "bg-warn-soft text-warn" : "text-ink-4"}`}>{n}</span>
                      </td>
                    ))}
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
