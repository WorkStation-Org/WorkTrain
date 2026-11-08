import { notFound } from "next/navigation";
import { Badge, Button, Card, Icon, PageHeader } from "@/components/ui";
import { attemptView } from "@/lib/learn-service";
import { learnerActor } from "@/lib/page";
import { ExamQuestion } from "./question";

export const dynamic = "force-dynamic";

const REASON: Record<string, string> = { submitted: "ตอบครบ", timeout: "หมดเวลา", left_page: "ออกจากหน้าสอบครบ 5 ครั้ง" };

/** หน้าสอบ — ทีละข้อ ย้อนกลับไม่ได้ · จบแล้วแสดงคะแนนและข้อที่ผิด ไม่เฉลย (spec §10 · ADR-0009) */
export default async function ExamPage({ params }: { params: Promise<{ assignmentId: string; attemptId: string }> }) {
  const actor = await learnerActor();
  const p = await params;
  // `Number()` ไม่ใช่ `parseInt()` — "12abc" ต้องเป็นไม่พบ ไม่ใช่ครั้งที่สอบ 12
  const view = await attemptView(actor.personId, Number(p.attemptId));
  if (!view || String(view.assignmentId) !== p.assignmentId) notFound();

  if (view.ended && view.result) {
    const r = view.result;
    return (
      <main className="mx-auto w-full max-w-2xl space-y-4">
        <PageHeader kicker="Exam result" title={view.setTitle} subtitle={`จบการสอบ · ${REASON[r.reason] ?? r.reason}`} />
        <Card className="flex flex-col items-center gap-4 py-10 text-center">
          <span className={`flex size-16 items-center justify-center rounded-[20px] border ${r.passed ? "border-success/30 bg-success-soft text-success" : "border-danger/30 bg-danger-soft text-danger"}`}>
            <Icon name={r.passed ? "check" : "x"} size={28} />
          </span>
          <p className="font-ui text-[56px] leading-none font-semibold tabular-nums text-fg">{r.percent}%</p>
          <Badge tone={r.passed ? "success" : "danger"} label={r.passed ? `ผ่าน · เกณฑ์ ${r.passPercent}%` : `ไม่ผ่าน · เกณฑ์ ${r.passPercent}%`} />
        </Card>
        {r.wrongQuestions.length > 0 && (
          <Card>
            <p className="mb-3 text-[15px] font-semibold text-fg">ข้อที่ตอบผิด</p>
            <p className="mb-3 text-[13px] text-muted">กลับไปอ่านเอกสารแล้วลองใหม่ — ระบบไม่เฉลยคำตอบ</p>
            <ul className="divide-y divide-line text-[13px] text-ink-2">
              {r.wrongQuestions.map((q, i) => (
                <li key={i} className="flex gap-2.5 py-2.5">
                  <Icon name="x" size={15} className="mt-0.5 text-danger" />
                  {q}
                </li>
              ))}
            </ul>
          </Card>
        )}
        <Button href={`/learn/${view.assignmentId}`} variant="primary" icon="chevronLeft">
          กลับไปหน้าชุด
        </Button>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-2xl">
      <ExamQuestion
        key={view.question!.id}
        attemptId={view.attemptId}
        title={view.setTitle}
        index={view.index!}
        total={view.total}
        secondsLeft={view.secondsLeft!}
        leaveCount={view.leaveCount}
        question={view.question!}
      />
    </main>
  );
}
