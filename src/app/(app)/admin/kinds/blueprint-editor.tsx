"use client";

import { useId, useState } from "react";
import { Icon, INPUT_CLASS } from "@/components/ui";

/**
 * ตารางแม่แบบข้อสอบ: หัวข้อ (ข้อความที่ TG ตั้ง) × ระดับ — ส่งไปเซิร์ฟเวอร์เป็น JSON ในช่องซ่อน `blueprint`
 * ★ เซิร์ฟเวอร์ตรวจซ้ำด้วย `checkBlueprint()` เสมอ — ยอดรวมตรงนี้ช่วยกรอกเท่านั้น
 * ★ ไม่ import จาก `@/domain/blueprint` (ดึง drizzle เข้า bundle ของเบราว์เซอร์) — หน้า server ส่งค่าที่ต้องใช้มาให้
 */

export interface EditorRow {
  topic: string;
  counts: Record<string, number>;
}

export function BlueprintEditor({
  initial,
  levels,
  total,
  topicMax,
}: {
  initial: EditorRow[];
  levels: { key: string; label: string }[];
  total: number;
  topicMax: number;
}) {
  const id = useId();
  const blank = (): EditorRow => ({ topic: "", counts: Object.fromEntries(levels.map((l) => [l.key, 0])) });
  const [rows, setRows] = useState<EditorRow[]>(initial.length ? initial : [blank()]);

  const sum = rows.reduce((n, r) => n + levels.reduce((m, l) => m + (r.counts[l.key] || 0), 0), 0);
  const json = JSON.stringify(rows.flatMap((r) => levels.map((l) => ({ topic: r.topic, level: l.key, count: r.counts[l.key] || 0 }))));

  const set = (i: number, patch: Partial<EditorRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div>
      <input type="hidden" name="blueprint" value={json} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-[13px]">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="pb-2 font-medium">หัวข้อ</th>
              {levels.map((l) => (
                <th key={l.key} className="w-24 pb-2 text-center font-medium">
                  {l.label}
                </th>
              ))}
              <th className="w-10 pb-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="align-middle">
                <td className="py-1 pr-2">
                  <input
                    aria-label={`หัวข้อแถวที่ ${i + 1}`}
                    value={r.topic}
                    maxLength={topicMax}
                    placeholder="เช่น ขั้นตอนการทำงาน"
                    onChange={(e) => set(i, { topic: e.target.value })}
                    className={INPUT_CLASS}
                  />
                </td>
                {levels.map((l) => (
                  <td key={l.key} className="px-1 py-1">
                    <input
                      aria-label={`${r.topic || `แถวที่ ${i + 1}`} ระดับ${l.label}`}
                      type="number"
                      min={0}
                      max={total}
                      inputMode="numeric"
                      value={r.counts[l.key] || 0}
                      onChange={(e) => set(i, { counts: { ...r.counts, [l.key]: Math.max(0, Number.parseInt(e.target.value, 10) || 0) } })}
                      className={`${INPUT_CLASS} text-center`}
                    />
                  </td>
                ))}
                <td className="py-1 pl-1">
                  <button
                    type="button"
                    title="ลบแถว"
                    aria-label="ลบแถว"
                    disabled={rows.length === 1}
                    onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                    className="press inline-flex size-9 items-center justify-center rounded-lg text-muted hover:bg-subtle hover:text-fg disabled:opacity-35"
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setRows((rs) => [...rs, blank()])}
          className="press inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs text-muted hover:bg-subtle hover:text-fg"
        >
          <Icon name="plus" size={14} /> เพิ่มหัวข้อ
        </button>
        <p id={`${id}-sum`} aria-live="polite" className={`text-[13px] font-medium ${sum === total ? "text-success" : "text-warn"}`}>
          รวม {sum} / {total} ข้อ
        </p>
      </div>
    </div>
  );
}
