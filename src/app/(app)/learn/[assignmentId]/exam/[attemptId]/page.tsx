import { notFound } from "next/navigation";
import { Alert, Badge, Button, Card, Icon, PageHeader } from "@/components/ui";
import { confirmedScanFor, scanMode } from "@/lib/identity-service";
import { attemptView } from "@/lib/learn-service";
import { firstParam, learnerActor } from "@/lib/page";
import { END_REASON } from "../../../end-reason";
import { ScanFlow } from "../../../scan-flow";
import { ExamQuestion } from "./question";

export const dynamic = "force-dynamic";

/**
 * หน้าสอบ — ทีละข้อ ย้อนแก้ได้จนกว่าจะส่ง (`?q=` = ข้อที่ดู) · จบแล้วแสดงคะแนนเป็นข้อและร้อยละ (spec §10 · ADR-0021)
 * ผ่าน = เฉลยข้อที่ผิด · ไม่ผ่าน = ไม่เฉลย แล้วทำใหม่ได้ 1 ครั้ง · ไม่ผ่านอีกครั้งต้องกลับไปเรียนใหม่
 */
export default async function ExamPage({
  params,
  searchParams,
}: {
  params: Promise<{ assignmentId: string; attemptId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await learnerActor();
  const p = await params;
  // ?q= เป็นเลขข้อที่คนเห็น (เริ่ม 1) · ไม่ใช่ตัวเลข = ข้อแรกที่ยังไม่ตอบ
  const q = Number(firstParam((await searchParams).q));
  // `Number()` ไม่ใช่ `parseInt()` — "12abc" ต้องเป็นไม่พบ ไม่ใช่ครั้งที่สอบ 12
  const view = await attemptView(actor.personId, Number(p.attemptId), new Date(), Number.isInteger(q) ? q - 1 : undefined);
  if (!view || String(view.assignmentId) !== p.assignmentId) notFound();

  if (view.ended && view.result) {
    const r = view.result;
    const setHref = `/learn/${view.assignmentId}`;
    const mode = scanMode();
    const confirmedExam = r.next === "retry" && mode !== "paused" ? await confirmedScanFor(actor.personId, "exam") : null;
    return (
      <main className="mx-auto w-full max-w-2xl space-y-4">
        <PageHeader title={view.setTitle} subtitle={`จบการสอบ · ${END_REASON[r.reason] ?? r.reason}`} />
        <Card className="flex flex-col items-center gap-3 py-10 text-center">
          <span className={`flex size-16 items-center justify-center rounded-[20px] border ${r.passed ? "border-success/30 bg-success-soft text-success" : "border-danger/30 bg-danger-soft text-danger"}`}>
            <Icon name={r.passed ? "check" : "x"} size={28} />
          </span>
          <p className="mt-1 text-[13px] text-muted">คะแนน</p>
          <p className="font-ui text-[56px] leading-none font-semibold tabular-nums text-fg" aria-label={`ได้ ${r.right} จาก ${view.total} คะแนน`}>
            {r.right}
            <span className="text-[28px] text-muted">/{view.total}</span>
          </p>
          <p className="font-ui text-[17px] font-semibold tabular-nums text-ink-2">{r.percent}%</p>
          <Badge tone={r.passed ? "success" : "danger"} label={r.passed ? `ผ่าน · เกณฑ์ ${r.passPercent}%` : `ไม่ผ่าน · เกณฑ์ ${r.passPercent}%`} />
        </Card>

        {r.answerKey && r.answerKey.length > 0 && (
          <Card>
            <p className="mb-1 text-[15px] font-semibold text-fg">เฉลยข้อที่ตอบผิด</p>
            <p className="mb-3 text-[13px] text-muted">สอบผ่านแล้ว — ดูคำตอบที่ถูกของข้อที่พลาดไว้ทบทวน</p>
            <ol className="divide-y divide-line">
              {r.answerKey.map((k, i) => (
                <li key={i} className="space-y-2 py-3.5">
                  <p className="text-[14px] font-medium text-fg">{k.question}</p>
                  <p className="flex gap-2 text-[13px] text-danger">
                    <Icon name="x" size={15} className="mt-0.5 shrink-0" />
                    <span>
                      <span className="text-muted">คุณตอบ · </span>
                      {k.yours ?? "ไม่ได้ตอบ"}
                    </span>
                  </p>
                  <p className="flex gap-2 text-[13px] text-success">
                    <Icon name="check" size={15} className="mt-0.5 shrink-0" />
                    <span>
                      <span className="text-muted">คำตอบที่ถูก · </span>
                      {k.correct}
                    </span>
                  </p>
                </li>
              ))}
            </ol>
          </Card>
        )}

        {!r.passed && r.wrongQuestions.length > 0 && (
          <Card>
            <p className="mb-1 text-[15px] font-semibold text-fg">ข้อที่ตอบผิด</p>
            <p className="mb-3 text-[13px] text-muted">ยังไม่ผ่านจึงไม่เฉลย — กลับไปทบทวนเนื้อหาเรื่องเหล่านี้</p>
            <ul className="divide-y divide-line text-[13px] text-ink-2">
              {r.wrongQuestions.map((text, i) => (
                <li key={i} className="flex gap-2.5 py-2.5">
                  <Icon name="x" size={15} className="mt-0.5 shrink-0 text-danger" />
                  {text}
                </li>
              ))}
            </ul>
          </Card>
        )}

        {r.next === "retry" && (
          <Card>
            <p className="mb-1 text-[15px] font-semibold text-fg">ทำใหม่</p>
            <p className="mb-4 text-[13px] text-ink-2">
              {r.retriesLeft === null
                ? "สอบส่วนที่เปลี่ยนใหม่ได้ — ได้ชุดข้อสอบใหม่"
                : `ทำใหม่ได้อีก ${r.retriesLeft} ครั้ง ได้ชุดข้อสอบใหม่ — ถ้าไม่ผ่านอีกต้องกลับไปดูคลิปและอ่านเอกสารให้ครบใหม่ก่อนสอบ`}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <ScanFlow
                mode={mode}
                purpose="exam"
                assignmentId={view.assignmentId}
                label={mode === "paused" ? "ทำใหม่" : "สแกนใบหน้า · ทำใหม่"}
                confirmedScanId={confirmedExam}
              />
              <Button href={setHref} variant="ghost">
                ทบทวนเนื้อหาก่อน
              </Button>
            </div>
          </Card>
        )}

        {r.next === "relearn" && (
          <Alert kind="warn" title="ต้องกลับไปเรียนใหม่">
            สอบไม่ผ่าน 2 ครั้งติด — ดูคลิปและอ่านเอกสารให้ครบอีกรอบ แล้วจึงสอบได้อีก
          </Alert>
        )}

        {r.next !== "retry" && (
          <Button href={setHref} variant="primary" icon={r.next === "relearn" ? "book" : "chevronLeft"}>
            {r.next === "relearn" ? "ไปเรียนใหม่" : "กลับไปหน้าชุด"}
          </Button>
        )}
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-2xl">
      <ExamQuestion
        key={view.question!.id}
        attemptId={view.attemptId}
        assignmentId={view.assignmentId}
        title={view.setTitle}
        index={view.index!}
        total={view.total}
        secondsLeft={view.secondsLeft!}
        leaveCount={view.leaveCount}
        answered={view.answered!}
        lastOpen={view.lastOpen!}
        question={view.question!}
      />
    </main>
  );
}
