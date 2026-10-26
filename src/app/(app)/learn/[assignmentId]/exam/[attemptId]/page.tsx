import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, PageHeader } from "@/components/ui";
import { attemptView } from "@/lib/learn-service";
import { learnerActor } from "@/lib/page";
import { ExamQuestion } from "./question";

export const dynamic = "force-dynamic";

const REASON: Record<string, string> = { submitted: "ตอบครบ", timeout: "หมดเวลา", left_page: "ออกจากหน้าสอบครบ 5 ครั้ง" };

/** หน้าสอบ — ทีละข้อ ย้อนกลับไม่ได้ · จบแล้วแสดงคะแนนและข้อที่ผิด ไม่เฉลย (spec §10 · ADR-0009) */
export default async function ExamPage({ params }: { params: Promise<{ assignmentId: string; attemptId: string }> }) {
  const actor = await learnerActor();
  const p = await params;
  const view = await attemptView(actor.personId, Number.parseInt(p.attemptId, 10));
  if (!view || String(view.assignmentId) !== p.assignmentId) notFound();

  if (view.ended && view.result) {
    const r = view.result;
    return (
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-8">
        <PageHeader title={view.setTitle} subtitle={`จบการสอบ · ${REASON[r.reason] ?? r.reason}`} />
        <Card>
          <p className="text-3xl font-bold text-ink">{r.percent}%</p>
          <div className="mt-2">
            <Badge tone={r.passed ? "success" : "danger"} label={r.passed ? `ผ่าน (เกณฑ์ ${r.passPercent}%)` : `ไม่ผ่าน (เกณฑ์ ${r.passPercent}%)`} />
          </div>
          {r.wrongQuestions.length > 0 && (
            <div className="mt-4 text-[13px]">
              <p className="mb-1 font-semibold">ข้อที่ตอบผิด — กลับไปอ่านเอกสารแล้วลองใหม่</p>
              <ul className="list-disc space-y-1 pl-5 text-ink-2">
                {r.wrongQuestions.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            </div>
          )}
          <Link href={`/learn/${view.assignmentId}`} className="mt-5 inline-block text-[13px] font-semibold underline">
            กลับไปหน้าชุด
          </Link>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
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
