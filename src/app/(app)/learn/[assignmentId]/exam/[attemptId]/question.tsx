"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, Card } from "@/components/ui";
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
  question: { id: number; text: string; choices: { id: number; text: string }[] };
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
    const out = await answerAction({ attemptId: props.attemptId, questionId: props.question.id, choiceId: choice });
    if (!out.ok) setError(out.error);
    router.refresh();
  }

  const mm = String(Math.floor(left / 60)).padStart(2, "0");
  const ss = String(left % 60).padStart(2, "0");
  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-[13px] text-ink-3">
        <span>
          {props.title} · ข้อ {props.index + 1}/{props.total}
        </span>
        <span className={left < 60 ? "font-semibold text-danger" : "font-semibold text-ink"}>
          ⏱ {mm}:{ss}
        </span>
      </div>
      {leaves > 0 && (
        <p className="mb-3 rounded-lg bg-warning-soft px-3 py-2 text-[13px] text-warning">
          ออกจากหน้าสอบแล้ว {leaves} ครั้ง — ครบ {MAX_LEAVES_BEFORE_SUBMIT} ครั้งระบบจะส่งข้อสอบให้ทันที
        </p>
      )}
      <p className="mb-4 text-[16px] font-medium text-ink">{props.question.text}</p>
      <div className="space-y-2">
        {props.question.choices.map((c) => (
          <label
            key={c.id}
            className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-[14px] ${choice === c.id ? "border-ink bg-surface-2" : "border-line"}`}
          >
            <input type="radio" name="choice" checked={choice === c.id} onChange={() => setChoice(c.id)} />
            {c.text}
          </label>
        ))}
      </div>
      {error && <p className="mt-3 text-[13px] text-danger">{error}</p>}
      <div className="mt-5 flex items-center justify-between">
        <span className="text-[12px] text-ink-3">ตอบแล้วย้อนกลับไม่ได้</span>
        <Button type="button" variant="primary" disabled={choice === null || busy} onClick={submit}>
          {props.index + 1 === props.total ? "ส่งคำตอบ" : "ข้อถัดไป"}
        </Button>
      </div>
    </Card>
  );
}
