"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Alert, Button, Card, Icon } from "@/components/ui";
import { MAX_LEAVES_BEFORE_SUBMIT } from "@/db/schema";
import { answerAction, leaveAction, submitAction } from "../../../actions";

/**
 * ข้อสอบหนึ่งข้อ — ทำทีละข้อ ย้อนกลับไปแก้ข้อที่ตอบแล้วได้จนกว่าจะกดส่ง · ข้ามไปข้อที่ยังไม่ถึงไม่ได้ (ADR-0021)
 * ข้อที่แสดงอยู่ใน URL (`?q=`) — เซิร์ฟเวอร์ตัดสินว่าเปิดได้ไหม · เปลี่ยนข้อ = บันทึกคำตอบของข้อนี้ก่อน (ถ้าเปลี่ยน)
 * นาฬิกานับถอยหลังเป็นแค่การแสดงผล (เซิร์ฟเวอร์ตัดสินหมดเวลาเอง)
 * สลับแท็บ/ย่อจอ = รายงานการออกจากหน้าสอบ · ครั้งที่ 5 เซิร์ฟเวอร์ส่งให้เอง
 */
export function ExamQuestion(props: {
  attemptId: number;
  assignmentId: number;
  title: string;
  index: number;
  total: number;
  secondsLeft: number;
  leaveCount: number;
  /** ข้อไหนตอบแล้ว (ตามลำดับที่แสดง) · เปิดได้ถึง `lastOpen` */
  answered: boolean[];
  lastOpen: number;
  /** ตัวเลือกมีแต่ข้อความ — ตอบด้วยตำแหน่งที่แสดง (0–3) · `chosen` = ที่ตอบไว้แล้ว */
  question: { id: number; text: string; choices: { text: string }[]; chosen: number | null };
}) {
  const router = useRouter();
  const [choice, setChoice] = useState<number | null>(props.question.chosen);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [left, setLeft] = useState(props.secondsLeft);
  const [leaves, setLeaves] = useState(props.leaveCount);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => {
      setLeft((s) => {
        if (s <= 1) {
          clearInterval(t);
          router.refresh();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [router]);

  useEffect(() => {
    const onHide = async () => {
      if (document.visibilityState !== "hidden") return;
      const out = await leaveAction({ attemptId: props.attemptId });
      if (out.ok) {
        setLeaves(out.leaveCount);
        if (out.submitted) router.refresh();
      }
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [props.attemptId, router]);

  /** บันทึกคำตอบของข้อนี้ถ้ายังไม่ได้บันทึก/เปลี่ยนไป · ไม่สำเร็จ = แสดงข้อความ คืน false */
  async function save(): Promise<boolean> {
    if (choice === null || choice === props.question.chosen) return true;
    const out = await answerAction({ attemptId: props.attemptId, questionId: props.question.id, choiceIndex: choice });
    if (out.ok) return true;
    setError(out.error);
    router.refresh(); // หมดเวลา/จบไปแล้ว — ให้หน้าแสดงผล
    return false;
  }

  async function go(index: number) {
    setBusy(true);
    setError(null);
    if (await save()) router.replace(`/learn/${props.assignmentId}/exam/${props.attemptId}?q=${index + 1}`);
    else setBusy(false);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    if (await save()) {
      const out = await submitAction({ attemptId: props.attemptId });
      if (!out.ok) {
        setError(out.error);
        setConfirming(false);
        setBusy(false);
        return;
      }
    }
    router.refresh();
  }

  const last = props.index + 1 === props.total;
  // ข้อนี้นับว่าตอบแล้วเมื่อเลือกไว้ แม้ยังไม่บันทึก — กดส่งจะบันทึกให้ก่อน
  const answered = props.answered.map((a, i) => a || (i === props.index && choice !== null));
  const answeredCount = answered.filter(Boolean).length;
  const allAnswered = answeredCount === props.total;
  const mm = String(Math.floor(left / 60)).padStart(2, "0");
  const ss = String(left % 60).padStart(2, "0");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="kicker mb-2">
            Question {props.index + 1} / {props.total}
          </p>
          <p className="truncate text-[13px] text-muted">{props.title}</p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-ui text-sm font-semibold tabular-nums ${left < 60 ? "border-danger/40 bg-danger-soft text-danger" : "border-line bg-raised text-fg"}`}
          aria-label={`เหลือเวลา ${mm}:${ss}`}
        >
          <Icon name="clock" size={15} />
          {mm}:{ss}
        </span>
      </div>
      {/* แถบความคืบหน้า — ข้อที่ตอบแล้ว */}
      <div className="h-1 overflow-hidden rounded-full bg-subtle" aria-hidden>
        <div className="h-full rounded-full bg-fg transition-[width] duration-300" style={{ width: `${(answeredCount / props.total) * 100}%` }} />
      </div>
      {/* ไปข้อที่ตอบแล้วได้ทุกข้อ · ข้อที่ยังไม่ถึงกดไม่ได้ */}
      <nav aria-label="เลือกข้อ" className="flex flex-wrap gap-1.5">
        {answered.map((done, i) => {
          const current = i === props.index;
          const open = i <= props.lastOpen;
          return (
            <button
              key={i}
              type="button"
              disabled={!open || current || busy}
              onClick={() => go(i)}
              aria-current={current ? "step" : undefined}
              aria-label={`ข้อ ${i + 1}${done ? " · ตอบแล้ว" : open ? " · ยังไม่ตอบ" : " · ยังไม่ถึง"}`}
              className={`press flex size-9 items-center justify-center rounded-[9px] border font-ui text-[13px] font-semibold tabular-nums transition-colors disabled:pointer-events-none ${
                current
                  ? "border-fg bg-fg text-canvas"
                  : done
                    ? "border-line-strong bg-subtle text-fg hover:border-fg"
                    : open
                      ? "border-line text-fg hover:border-line-strong hover:bg-subtle"
                      : "border-dashed border-line text-muted opacity-50"
              }`}
            >
              {i + 1}
            </button>
          );
        })}
      </nav>
      {leaves > 0 && (
        <Alert kind="warn">
          ออกจากหน้าสอบแล้ว {leaves} ครั้ง — ครบ {MAX_LEAVES_BEFORE_SUBMIT} ครั้งระบบจะส่งข้อสอบให้ทันที
        </Alert>
      )}
      <Card>
        <p className="mb-5 text-[17px] leading-relaxed font-medium text-fg">{props.question.text}</p>
        <div role="radiogroup" aria-label="ตัวเลือก" className="space-y-2">
          {props.question.choices.map((c, i) => (
            <label
              key={i}
              className={`press flex cursor-pointer items-center gap-3 rounded-[11px] border px-4 py-3 text-sm transition-colors ${choice === i ? "border-fg bg-subtle text-fg" : "border-line text-fg hover:border-line-strong hover:bg-subtle"}`}
            >
              <span
                className={`flex size-7 shrink-0 items-center justify-center rounded-full border font-ui text-xs font-semibold ${choice === i ? "border-fg bg-fg text-canvas" : "border-line-strong text-muted"}`}
                aria-hidden
              >
                {"กขคง"[i] ?? i + 1}
              </span>
              <input
                type="radio"
                name="choice"
                className="sr-only"
                checked={choice === i}
                disabled={busy}
                onChange={() => {
                  setChoice(i);
                  setConfirming(false);
                }}
              />
              <span className="min-w-0 flex-1">{c.text}</span>
            </label>
          ))}
        </div>
        {error && <Alert className="mt-4">{error}</Alert>}
        {confirming ? (
          <div className="mt-6 rounded-[11px] border border-line-strong bg-subtle p-4">
            <p className="text-[14px] font-semibold text-fg">ส่งคำตอบทั้ง {props.total} ข้อ?</p>
            <p className="mt-1 text-[13px] text-muted">ส่งแล้วกลับมาแก้ไม่ได้ — ถ้ายังไม่แน่ใจ กดเลขข้อด้านบนเพื่อตรวจก่อน</p>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
                ตรวจอีกครั้ง
              </Button>
              <Button type="button" variant="primary" icon="check" disabled={busy} onClick={submit}>
                {busy ? "กำลังส่ง…" : "ยืนยันส่งคำตอบ"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <Button type="button" variant="ghost" icon="chevronLeft" disabled={props.index === 0 || busy} onClick={() => go(props.index - 1)}>
              ข้อก่อนหน้า
            </Button>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {!last && (
                <Button type="button" variant={allAnswered ? "secondary" : "primary"} icon="arrow" disabled={choice === null || busy} onClick={() => go(props.index + 1)}>
                  ข้อถัดไป
                </Button>
              )}
              {(last || allAnswered) && (
                <Button type="button" variant="primary" icon="check" disabled={!allAnswered || busy} onClick={() => setConfirming(true)}>
                  ส่งคำตอบ
                </Button>
              )}
            </div>
          </div>
        )}
        <p className="mt-4 text-xs text-muted">ย้อนกลับไปแก้คำตอบได้จนกว่าจะกดส่ง · ตอบแล้ว {answeredCount} จาก {props.total} ข้อ</p>
      </Card>
    </div>
  );
}
