"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, INPUT_CLASS } from "@/components/ui";
import { regenerateQuestionInPlaceAction, saveQuestionAction, setReviewAction } from "../actions";

/**
 * ข้อสอบ 5 ชุดเป็นแท็บ · แก้ในการ์ดของข้อนั้นเลย บันทึกแล้วอยู่ที่เดิม (ไม่ redirect ไม่ปิดทุกชุด) ·
 * "ตรวจแล้ว" ทีละข้อ จำแยกต่อคน — ผู้อนุมัติรู้ว่าเหลือกี่ข้อ ไม่ต้องย้อนเปิดดูใหม่
 */

export interface QuestionCard {
  id: number;
  meta: string;
  text: string;
  sourceRef: string;
  choices: { text: string; isCorrect: boolean }[];
  priceMismatch: boolean;
}

export interface FormTab {
  id: number;
  formNo: number;
  delta: boolean;
  questions: QuestionCard[];
}

export function ExamWorkspace({
  setId,
  forms,
  reviewedIds,
  canEdit,
  canReview,
  initialForm,
}: {
  setId: number;
  forms: FormTab[];
  reviewedIds: number[];
  canEdit: boolean;
  canReview: boolean;
  initialForm?: number;
}) {
  const router = useRouter();
  const [formId, setFormId] = useState(forms.find((f) => f.formNo === initialForm)?.id ?? forms[0]?.id);
  const [editing, setEditing] = useState<number | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const [reviewed, setReviewed] = useState(() => new Set(reviewedIds));
  const form = forms.find((f) => f.id === formId) ?? forms[0];
  const all = forms.flatMap((f) => f.questions);
  const done = all.filter((q) => reviewed.has(q.id)).length;

  function pickForm(f: FormTab) {
    setFormId(f.id);
    setEditing(null);
    setSaved(null);
    // จำชุดที่เปิดไว้ใน URL — รีเฟรชหรือกลับมาหน้านี้ยังอยู่ชุดเดิม
    // ★ ผ่าน router ของ Next ไม่ใช่ history.replaceState ตรง ๆ — URL ที่ router ไม่รู้ทำให้การ refresh ครั้งแรกหลังกด
    //   "ตรวจแล้ว"/"บันทึก" กลายเป็นการเปิดหน้าใหม่แล้วเลื่อนขึ้นบนสุด
    const url = new URL(window.location.href);
    url.searchParams.set("form", String(f.formNo));
    router.replace(`${url.pathname}${url.search}`, { scroll: false });
  }

  async function toggleReview(q: QuestionCard) {
    const next = !reviewed.has(q.id);
    setReviewed((s) => {
      const n = new Set(s);
      if (next) n.add(q.id);
      else n.delete(q.id);
      return n;
    });
    const out = await setReviewAction({ setId, questionId: q.id, reviewed: next }).catch(() => null);
    if (!out?.ok) {
      setReviewed((s) => {
        const n = new Set(s);
        if (next) n.delete(q.id);
        else n.add(q.id);
        return n;
      });
    }
  }

  if (!form) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="ชุดข้อสอบ" className="flex flex-wrap gap-1 rounded-xl bg-subtle p-1">
          {forms.map((f) => {
            const n = f.questions.filter((q) => reviewed.has(q.id)).length;
            return (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={f.id === form.id}
                onClick={() => pickForm(f)}
                className={`min-h-10 rounded-[9px] px-3.5 text-[13px] ${f.id === form.id ? "bg-raised font-semibold text-fg shadow-sm" : "text-ink-2 hover:text-fg"}`}
              >
                {f.delta ? "ส่วนที่เปลี่ยน · " : ""}ชุดที่ {f.formNo}{" "}
                <span className={`font-normal ${n === f.questions.length ? "text-success" : "text-muted"}`}>
                  {n}/{f.questions.length}
                </span>
                {f.questions.some((q) => q.priceMismatch) && <span className="ml-1 text-danger">●</span>}
              </button>
            );
          })}
        </div>
        {canReview && (
          <div className="flex min-w-56 flex-col gap-1">
            <span className="text-[12px] text-muted">
              คุณตรวจแล้ว {done} / {all.length} ข้อ
            </span>
            <span className="block h-1.5 overflow-hidden rounded-full bg-subtle">
              <span className="block h-full rounded-full bg-success" style={{ width: `${all.length ? (done / all.length) * 100 : 0}%` }} />
            </span>
          </div>
        )}
      </div>

      <ol className="space-y-2.5">
        {form.questions.map((q, i) => (
          <li key={q.id}>
            {editing === q.id ? (
              <EditCard
                setId={setId}
                q={q}
                no={i + 1}
                onCancel={() => setEditing(null)}
                onSaved={(next) => {
                  setSaved(q.id);
                  setReviewed((s) => new Set(s).add(q.id));
                  setEditing(next ? (form.questions[i + 1]?.id ?? null) : null);
                  router.refresh();
                }}
              />
            ) : (
              <ViewCard
                setId={setId}
                q={q}
                no={i + 1}
                justSaved={saved === q.id}
                reviewed={reviewed.has(q.id)}
                canEdit={canEdit}
                canReview={canReview}
                onEdit={() => {
                  setEditing(q.id);
                  setSaved(null);
                }}
                onToggleReview={() => toggleReview(q)}
                onRegenerated={() => {
                  setReviewed((s) => {
                    const n = new Set(s);
                    n.delete(q.id);
                    return n;
                  });
                  setSaved(q.id);
                  router.refresh();
                }}
              />
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function ViewCard({
  setId,
  q,
  no,
  justSaved,
  reviewed,
  canEdit,
  canReview,
  onEdit,
  onToggleReview,
  onRegenerated,
}: {
  setId: number;
  q: QuestionCard;
  no: number;
  justSaved: boolean;
  reviewed: boolean;
  canEdit: boolean;
  canReview: boolean;
  onEdit: () => void;
  onToggleReview: () => void;
  onRegenerated: () => void;
}) {
  const [regen, setRegen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function regenerate() {
    if (!confirm("ให้ AI ออกข้อนี้ใหม่? ข้อเดิมจะถูกแทน (เก็บไว้ในประวัติ)")) return;
    setRegen(true);
    setError(null);
    const out = await regenerateQuestionInPlaceAction({ setId, questionId: q.id }).catch(() => null);
    setRegen(false);
    if (!out?.ok) return setError(out?.error ?? "AI ออกข้อใหม่ไม่สำเร็จ");
    onRegenerated();
  }

  return (
    <div className={`flex flex-wrap gap-3 rounded-[13px] border bg-raised px-4 py-3.5 ${justSaved ? "border-success" : "border-line"}`}>
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-subtle text-[13px] font-semibold">{no}</span>
      <div className="min-w-0 flex-[1_1_360px] space-y-2">
        <p className="text-[12px] text-muted">
          {q.meta} · ที่มา {q.sourceRef}
          {q.priceMismatch && <span className="ml-2 font-semibold text-danger">ราคาไม่ตรง Pricelist</span>}
        </p>
        <p className="text-[15px] font-semibold leading-relaxed text-fg">{q.text}</p>
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-1.5">
          {q.choices.map((c, k) => (
            <li key={k} className={`rounded-lg px-2.5 py-1.5 text-[14px] ${c.isCorrect ? "bg-success-soft font-semibold text-success" : "bg-canvas text-ink-2"}`}>
              {c.isCorrect ? "✓ " : "· "}
              {c.text}
            </li>
          ))}
        </ul>
        {justSaved && <p className="text-[12px] font-semibold text-success">✓ บันทึกแล้ว — อยู่ที่ข้อเดิม</p>}
        {error && <p className="text-[12px] text-danger">{error}</p>}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        {canEdit && (
          <Button type="button" size="sm" onClick={onEdit} disabled={regen}>
            แก้ข้อนี้
          </Button>
        )}
        {canReview && (
          <button
            type="button"
            aria-pressed={reviewed}
            onClick={onToggleReview}
            className={`min-h-9 rounded-lg px-3 text-[13px] ${reviewed ? "border border-success/30 bg-success-soft font-semibold text-success" : "border border-dashed border-ink-4 text-ink-2 hover:bg-subtle"}`}
          >
            {reviewed ? "✓ ตรวจแล้ว" : "ตรวจแล้ว"}
          </button>
        )}
        {canEdit && (
          <button type="button" onClick={regenerate} disabled={regen} className="min-h-8 text-[12px] text-muted underline disabled:no-underline">
            {regen ? "AI กำลังออกข้อนี้ใหม่…" : "ให้ AI ออกข้อนี้ใหม่"}
          </button>
        )}
      </div>
    </div>
  );
}

function EditCard({
  setId,
  q,
  no,
  onCancel,
  onSaved,
}: {
  setId: number;
  q: QuestionCard;
  no: number;
  onCancel: () => void;
  onSaved: (goNext: boolean) => void;
}) {
  const [text, setText] = useState(q.text);
  const [choices, setChoices] = useState(q.choices.map((c) => c.text));
  const [correct, setCorrect] = useState(Math.max(0, q.choices.findIndex((c) => c.isCorrect)));
  const [source, setSource] = useState(q.sourceRef);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(goNext: boolean) {
    setBusy(true);
    setError(null);
    const out = await saveQuestionAction({ setId, questionId: q.id, edit: { text, sourceRef: source, choices, correctIndex: correct } }).catch(() => null);
    setBusy(false);
    if (!out?.ok) return setError(out?.error ?? "บันทึกไม่สำเร็จ");
    onSaved(goNext);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save(false);
      }}
      className="space-y-3 rounded-[13px] border-2 border-fg bg-raised px-4 py-3.5"
    >
      <div className="flex flex-wrap justify-between gap-2">
        <span className="text-[14px] font-semibold">แก้ข้อ {no}</span>
        <span className="text-[12px] text-muted">{q.meta}</span>
      </div>
      <label className="block space-y-1.5">
        <span className="text-[12px] text-ink-2">คำถาม</span>
        <textarea value={text} onChange={(e) => setText(e.target.value)} required rows={2} className={INPUT_CLASS} />
      </label>
      <fieldset className="space-y-1.5">
        <legend className="mb-1.5 text-[12px] text-ink-2">ตัวเลือก — เลือกข้อที่ถูก</legend>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-2">
          {choices.map((c, k) => (
            <label key={k} className="flex min-h-11 items-center gap-2 rounded-lg border border-line-strong bg-raised px-2.5">
              <input type="radio" name={`correct-${q.id}`} checked={correct === k} onChange={() => setCorrect(k)} aria-label={`ตัวเลือก ${k + 1} ถูก`} className="size-4 accent-[var(--color-success)]" />
              <input
                value={c}
                onChange={(e) => setChoices((cs) => cs.map((x, j) => (j === k ? e.target.value : x)))}
                required
                aria-label={`ตัวเลือก ${k + 1}`}
                className="min-w-0 flex-1 bg-transparent text-[14px] outline-none"
              />
            </label>
          ))}
        </div>
      </fieldset>
      <label className="block max-w-md space-y-1.5">
        <span className="text-[12px] text-ink-2">ที่มาในเอกสาร</span>
        <input value={source} onChange={(e) => setSource(e.target.value)} required className={INPUT_CLASS} />
      </label>
      {error && <p className="text-[13px] text-danger">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? "กำลังบันทึก…" : "บันทึก"}
        </Button>
        <Button type="button" onClick={() => save(true)} disabled={busy}>
          บันทึก แล้วแก้ข้อถัดไป
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          ยกเลิก
        </Button>
      </div>
    </form>
  );
}
