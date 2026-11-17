import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Badge, Button, Card, PageHeader, SectionTitle } from "@/components/ui";
import { confirmedScanFor, enrollmentState, scanMode } from "@/lib/identity-service";
import { learnView } from "@/lib/learn-service";
import { firstParam, learnerActor } from "@/lib/page";
import { formatThaiDay, relativeDue } from "@/lib/time";
import { acknowledgeVersionAction, endStudyAction } from "../actions";
import { END_REASON } from "../end-reason";
import { ScanFlow } from "../scan-flow";
import { LessonWorkspace } from "./reader";

export const dynamic = "force-dynamic";

/** จำนวนข้อของชุดข้อสอบเต็ม (ADR-0003) */
const QUESTIONS = 10;

/**
 * หน้าเรียนของการมอบหนึ่ง — ขั้น 1 ดูคลิป/อ่านเอกสารให้ครบ → ขั้น 2 สอบ → ขั้น 3 ผ่าน (spec §9 · §10)
 * ★ ผู้เรียนไม่ต้องรู้จัก "รอบเรียน" หรือ "ช่วง" — บอกเป็นเริ่มเรียน/พักไว้ก่อน และเวลาที่ดูแล้ว
 * พักการสแกนอยู่ (ADR-0019) = ปุ่มเริ่มเรียน/เริ่มสอบเฉย ๆ ไม่ต้องลงทะเบียนใบหน้า
 */
export default async function LearnSetPage({
  params,
  searchParams,
}: {
  params: Promise<{ assignmentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await learnerActor();
  const id = Number.parseInt((await params).assignmentId, 10);
  const now = new Date();
  const view = Number.isInteger(id) ? await learnView(actor.personId, id, now) : null;
  if (!view) notFound();
  const err = firstParam((await searchParams).err);
  const mode = scanMode();
  const paused = mode === "paused";
  const enrolled = paused || (await enrollmentState(actor.personId)).state === "active";
  const confirmedStudy = paused ? null : await confirmedScanFor(actor.personId, "study");
  const confirmedExam = paused ? null : await confirmedScanFor(actor.personId, "exam");
  const scanLabel = (step: string) => (paused ? step : `สแกนใบหน้า · ${step}`);

  const due = view.assignment.dueAt;
  const late = view.state !== "passed" && due <= now;
  const docsDone = view.documents.filter((d) => d.completed).length;
  const docsTotal = view.documents.length;
  const step = view.state === "passed" || view.state === "update_ack" || view.state === "update_exam" ? 3 : view.state === "ready" || view.state === "in_exam" ? 2 : 1;

  return (
    <main className="mx-auto w-full max-w-6xl space-y-5">
      <PageHeader
        title={view.set.title}
        subtitle={
          view.state === "passed" ? (
            `${view.versionLabel ? `${view.versionLabel} · ` : ""}สอบผ่านแล้ว`
          ) : (
            <>
              {view.versionLabel ? `${view.versionLabel} · ` : ""}
              <span className={late ? "font-semibold text-danger" : ""}>
                ต้องสอบผ่านภายใน {formatThaiDay(due, now)} · {relativeDue(due, now)}
              </span>
            </>
          )
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {view.session && (
              <form action={endStudyAction} className="flex items-center gap-2 rounded-[10px] border border-line bg-raised py-1 pl-3 pr-1">
                <span className="size-2 rounded-full bg-success" aria-hidden />
                <span className="text-[13px] text-ink-2">กำลังเรียน · ไม่แตะจอ 2 นาที ระบบพักให้</span>
                <input type="hidden" name="assignmentId" value={view.assignment.id} />
                <Button type="submit" size="sm" variant="ghost">
                  พักไว้ก่อน
                </Button>
              </form>
            )}
            <Button href="/learn" variant="ghost" icon="chevronLeft">
              ชุดที่ต้องเรียน
            </Button>
          </div>
        }
      />
      {err && <Alert>{err}</Alert>}

      <ol aria-label="ขั้นตอน" className="grid gap-2 rounded-[13px] border border-line bg-raised p-3 sm:grid-cols-3 sm:p-4">
        <Step no={1} current={step === 1} done={step > 1} title="ดูคลิปและอ่านเอกสารให้ครบ" sub={`ครบแล้ว ${docsDone} จาก ${docsTotal} รายการ`} />
        <Step
          no={2}
          current={step === 2}
          done={step > 2}
          title={`สอบ ${QUESTIONS} ข้อ ต้องได้ ${view.set.passPercent}% ขึ้นไป`}
          sub={step === 1 ? `${view.set.examMinutes} นาที · เปิดได้เมื่อขั้นที่ 1 ครบ` : `${view.set.examMinutes} นาที · ทำทีละข้อ`}
        />
        <Step no={3} current={false} done={view.state === "passed"} title="ผ่าน" sub="ผลส่งเข้าสถิติและ WorkHR ให้เอง" />
      </ol>

      {!enrolled && view.state !== "passed" && (
        <Alert kind="warn" icon="face">
          ต้องลงทะเบียนใบหน้าก่อนเริ่มเรียน —{" "}
          <Link href="/enroll" className="font-semibold underline">
            ลงทะเบียนใบหน้า
          </Link>
        </Alert>
      )}

      {view.state === "passed" && <Alert kind="success" title="สอบผ่านชุดนี้แล้ว">ผลนี้นับในสถิติประจำเดือนและส่งให้ WorkHR แล้ว</Alert>}
      {view.update && (view.state === "update_ack" || view.state === "update_exam") && (
        <Card>
          <SectionTitle className="mb-2">เอกสารอัปเดต{view.update.label ? ` · ${view.update.label}` : ""}</SectionTitle>
          <p className="mb-3 text-[14px] text-ink-2">
            {view.update.kind === "small"
              ? "อ่านสิ่งที่เปลี่ยนด้านล่าง แล้วกดรับทราบ — ไม่ต้องสอบ"
              : "สอบเพิ่มเฉพาะส่วนที่เปลี่ยน 5 ข้อให้ผ่าน — ผลผ่านเดิมยังอยู่"}
          </p>
          <div className="mb-4 whitespace-pre-line rounded-lg border border-line bg-subtle px-3.5 py-3 text-[14px] text-ink-2">{view.update.summary}</div>
          {view.update.kind === "small" ? (
            <form action={acknowledgeVersionAction}>
              <input type="hidden" name="assignmentId" value={view.assignment.id} />
              <input type="hidden" name="versionId" value={view.update.versionId} />
              <Button type="submit" variant="primary">
                อ่านแล้ว รับทราบ
              </Button>
            </form>
          ) : (
            <ScanFlow mode={mode} purpose="exam" assignmentId={view.assignment.id} label={scanLabel("สอบส่วนที่เปลี่ยน 5 ข้อ")} confirmedScanId={confirmedExam} />
          )}
        </Card>
      )}
      {view.state === "relearn" && (
        <Alert kind="warn" title="ต้องทบทวนก่อนสอบใหม่">
          สอบไม่ผ่าน 2 ครั้งติด — ดูคลิปและอ่านเอกสารให้ครบอีกรอบ แล้วสอบได้อีก
        </Alert>
      )}
      {view.state === "in_exam" && view.openAttemptId && (
        <Card>
          <p className="mb-3 text-[14px]">มีข้อสอบที่ทำค้างอยู่ — ระหว่างนี้เปิดคลิปและเอกสารไม่ได้จนกว่าจะส่งคำตอบ</p>
          <Button href={`/learn/${view.assignment.id}/exam/${view.openAttemptId}`} variant="primary">
            กลับไปทำข้อสอบต่อ
          </Button>
        </Card>
      )}

      {view.state !== "passed" && view.state !== "in_exam" && (
        <LessonWorkspace
          assignmentId={view.assignment.id}
          documents={view.documents}
          viewer={`${actor.name} · ${actor.email}`}
          active={Boolean(view.session)}
          examRules={[
            `${QUESTIONS} ข้อ · ${view.set.examMinutes} นาที · ต้องได้ ${view.set.passPercent}% ขึ้นไป`,
            "ทำทีละข้อ ตอบแล้วกลับไปแก้ไม่ได้",
            "ระหว่างสอบเปิดคลิปและเอกสารไม่ได้",
            "สลับไปหน้าอื่นครบ 5 ครั้ง ระบบจะส่งคำตอบให้ทันที",
          ]}
          start={
            <Card>
              <SectionTitle className="mb-2">เริ่มเรียน</SectionTitle>
              {enrolled ? (
                <>
                  <p className="mb-3 text-[14px] text-ink-2">
                    {paused ? "กดเริ่มเรียนเพื่อเปิดคลิปและเอกสาร" : "สแกนใบหน้าเพื่อเปิดคลิปและเอกสาร"} · ถ้าไม่แตะจอ 2 นาที ระบบจะพักให้ ต้อง
                    {paused ? "กดเริ่มเรียนอีกครั้ง" : "สแกนอีกครั้ง"} — ส่วนที่ดู/อ่านไปแล้วไม่หาย
                  </p>
                  <ScanFlow mode={mode} purpose="study" label={scanLabel(view.documents.some((d) => d.pagesSeen.length > 0) ? "เรียนต่อ" : "เริ่มเรียน")} confirmedScanId={confirmedStudy} />
                </>
              ) : (
                <p className="text-[14px] text-ink-2">ลงทะเบียนใบหน้าก่อน แล้วจึงสแกนเพื่อเริ่มเรียนได้</p>
              )}
            </Card>
          }
          exam={
            view.state === "ready" ? (
              <ScanFlow mode={mode} purpose="exam" assignmentId={view.assignment.id} label={scanLabel(`เริ่มสอบ ${QUESTIONS} ข้อ`)} confirmedScanId={confirmedExam} />
            ) : undefined
          }
        />
      )}

      {view.attempts.length > 0 && (
        <Card>
          <SectionTitle className="mb-3">สอบไปแล้ว</SectionTitle>
          <ul className="divide-y divide-line text-[14px]">
            {view.attempts.map((t, i) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2 py-2.5">
                ครั้งที่ {i + 1}
                {t.kind === "delta" ? " (ส่วนที่เปลี่ยน)" : ""} · {t.scorePercent}% <Badge tone={t.passed ? "success" : "danger"} label={t.passed ? "ผ่าน" : "ไม่ผ่าน"} />
                <span className="text-muted">{END_REASON[t.endReason ?? ""] ?? ""}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </main>
  );
}

function Step({ no, title, sub, current, done }: { no: number; title: string; sub: string; current: boolean; done: boolean }) {
  return (
    <li aria-current={current ? "step" : undefined} className={`flex items-start gap-3 rounded-[10px] p-2.5 ${current ? "bg-subtle" : ""}`}>
      <span
        className={`flex size-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold ${
          done ? "bg-success text-white" : current ? "bg-fg text-canvas" : "border border-line-strong text-muted"
        }`}
      >
        {done ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-label="เสร็จแล้ว" role="img">
            <path d="M5 12l5 5L20 7" />
          </svg>
        ) : (
          no
        )}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className={`text-[14px] font-semibold ${current || done ? "text-fg" : "text-ink-2"}`}>{title}</span>
        <span className="text-[13px] text-muted">{sub}</span>
      </span>
    </li>
  );
}
