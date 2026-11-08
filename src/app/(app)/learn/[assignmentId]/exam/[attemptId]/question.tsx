"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Alert, Button, Card, Icon } from "@/components/ui";
import { MAX_LEAVES_BEFORE_SUBMIT } from "@/db/schema";
import { answerAction, leaveAction } from "../../../actions";

/**
 * ข้อสอบหนึ่งข้อ — นาฬิกานับถอยหลังเป็นแค่การแสดงผล (เซิร์ฟเวอร์ตัดสินหมดเวลาเอง)
 * สลับแท็บ/ย่อจอ = รายงานการออกจากหน้าสอบ · ครั้งที่ 5 เซิร์ฟเวอร์ส่งให้เอง
 */
export function ExamQuestion(props: {
  attemptId: number;
  title: string;
  index: number;
  total: number;
  secondsLeft: number;
  leaveCount: number;
  /** ตัวเลือกมีแต่ข้อความ — ตอบด้วยตำแหน่งที่แสดง (0–3) */
  question: { id: number; text: string; choices: { text: string }[] };
}) {
  const router = useRouter();
  const [choice, setChoice] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
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

  async function submit() {
    if (choice === null) return;
    setBusy(true);
    const out = await answerAction({ attemptId: props.attemptId, questionId: props.question.id, choiceIndex: choice });
    if (!out.ok) setError(out.error);
    router.refresh();
  }

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
        <div className="h-full rounded-full bg-fg transition-[width] duration-300" style={{ width: `${(props.index / props.total) * 100}%` }} />
      </div>
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
              <input type="radio" name="choice" className="sr-only" checked={choice === i} onChange={() => setChoice(i)} />
              <span className="min-w-0 flex-1">{c.text}</span>
            </label>
          ))}
        </div>
        {error && <Alert className="mt-4">{error}</Alert>}
        <div className="mt-6 flex items-center justify-between gap-3">
          <span className="text-xs text-muted">ตอบแล้วย้อนกลับไม่ได้</span>
          <Button type="button" variant="primary" disabled={choice === null || busy} onClick={submit} icon={props.index + 1 === props.total ? "check" : "arrow"}>
            {props.index + 1 === props.total ? "ส่งคำตอบ" : "ข้อถัดไป"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
