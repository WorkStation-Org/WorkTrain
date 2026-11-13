import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Badge, Button, Card, PageHeader, SectionTitle } from "@/components/ui";
import { confirmedScanFor, enrollmentState, scanMode } from "@/lib/identity-service";
import { learnView } from "@/lib/learn-service";
import { firstParam, learnerActor } from "@/lib/page";
import { formatBangkok } from "@/lib/time";
import { acknowledgeVersionAction, endStudyAction } from "../actions";
import { ScanFlow } from "../scan-flow";
import { LessonWorkspace } from "./reader";

export const dynamic = "force-dynamic";

const REASON: Record<string, string> = { submitted: "ส่งเอง", timeout: "หมดเวลา", left_page: "ออกจากหน้าสอบครบ 5 ครั้ง" };

/** หน้าเรียนของการมอบหนึ่ง — สแกนเริ่มรอบ → อ่านครบทุกหน้า + ดูวิดีโอครบทุกช่วง → สแกนเริ่มสอบ (spec §9 · §10) */
export default async function LearnSetPage({
  params,
  searchParams,
}: {
  params: Promise<{ assignmentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await learnerActor();
  const id = Number.parseInt((await params).assignmentId, 10);
  const view = Number.isInteger(id) ? await learnView(actor.personId, id) : null;
  if (!view) notFound();
  const err = firstParam((await searchParams).err);
  const mode = scanMode();
  const enrolled = (await enrollmentState(actor.personId)).state === "active";
  const confirmedStudy = await confirmedScanFor(actor.personId, "study");
  const confirmedExam = await confirmedScanFor(actor.personId, "exam");

  return (
    <main className="mx-auto w-full max-w-6xl space-y-5">
      <PageHeader
        kicker="Learning set"
        title={view.set.title}
        subtitle={`${view.versionLabel ? `${view.versionLabel} · ` : ""}กำหนดส่ง ${formatBangkok(view.assignment.dueAt)} · ผ่าน ${view.set.passPercent}% · สอบ ${view.set.examMinutes} นาที`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {view.session && (
              <form action={endStudyAction} className="flex items-center gap-2 rounded-[10px] border border-line bg-raised py-1 pl-3 pr-1">
                <span className="size-2 rounded-full bg-success" aria-hidden />
                <span className="text-[12px] text-ink-2">รอบเรียนเปิดอยู่ · นิ่งเกิน 2 นาทีจบรอบ</span>
                <input type="hidden" name="assignmentId" value={view.assignment.id} />
                <Button type="submit" size="sm" variant="ghost">
                  จบรอบเรียน
                </Button>
              </form>
            )}
            <Button href="/learn" variant="ghost" icon="chevronLeft">
              ชุดทั้งหมด
            </Button>
          </div>
        }
      />
      {err && <Alert>{err}</Alert>}

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
          <SectionTitle className="mb-2">มีเวอร์ชันใหม่{view.update.label ? ` · ${view.update.label}` : ""}</SectionTitle>
          <p className="mb-3 text-[13px] text-ink-3">
            {view.update.kind === "small"
              ? "อ่านเพื่อรับทราบ — อ่านสิ่งที่เปลี่ยนแล้วกดรับทราบ ไม่ต้องสอบ"
              : "เรียนรู้และทดสอบ — สอบเฉพาะส่วนที่เปลี่ยน 5 ข้อให้ผ่าน (ผลผ่านเดิมยังอยู่)"}
          </p>
          <div className="mb-4 whitespace-pre-line rounded-lg border border-line bg-subtle px-3.5 py-3 text-[13px] text-ink-2">{view.update.summary}</div>
          {view.update.kind === "small" ? (
            <form action={acknowledgeVersionAction}>
              <input type="hidden" name="assignmentId" value={view.assignment.id} />
              <input type="hidden" name="versionId" value={view.update.versionId} />
              <Button type="submit" variant="primary">
                อ่านแล้ว รับทราบ
              </Button>
            </form>
          ) : (
            <ScanFlow mode={mode} purpose="exam" assignmentId={view.assignment.id} label="สแกนใบหน้า · สอบส่วนที่เปลี่ยน" confirmedScanId={confirmedExam} />
          )}
        </Card>
      )}
      {view.state === "relearn" && (
        <Alert kind="warn" title="สอบไม่ผ่าน 2 ครั้งติด">อ่านเอกสารให้ครบทุกหน้าและดูวิดีโอให้ครบทุกช่วงอีกรอบก่อนสอบใหม่</Alert>
      )}
      {view.state === "in_exam" && view.openAttemptId && (
        <Card>
          <p className="mb-3 text-[13px]">มีการสอบที่ยังค้างอยู่ — เอกสารถูกล็อกจนกว่าจะส่ง</p>
          <Button href={`/learn/${view.assignment.id}/exam/${view.openAttemptId}`} variant="primary">
            กลับไปสอบต่อ
          </Button>
        </Card>
      )}

      {view.state !== "passed" && view.state !== "in_exam" && (
        <LessonWorkspace
          assignmentId={view.assignment.id}
          documents={view.documents}
          viewer={`${actor.name} · ${actor.email}`}
          active={Boolean(view.session)}
          examNote={`10 ข้อ · ${view.set.examMinutes} นาที · ทีละข้อ ย้อนกลับไม่ได้ · เปิดเนื้อหาไม่ได้ระหว่างสอบ · ออกจากหน้าสอบครบ 5 ครั้ง = ส่งเอง`}
          start={
            <Card>
              <SectionTitle className="mb-2">เริ่มรอบเรียน</SectionTitle>
              {enrolled ? (
                <>
                  <p className="mb-3 text-[13px] text-ink-3">
                    สแกนใบหน้าเพื่อเริ่มรอบเรียน · นิ่งเกิน 2 นาทีรอบจะจบ ต้องสแกนใหม่ (หน้าและช่วงวิดีโอที่ดูแล้วยังนับอยู่)
                  </p>
                  <ScanFlow mode={mode} purpose="study" label="สแกนใบหน้า · เริ่มเรียน" confirmedScanId={confirmedStudy} />
                </>
              ) : (
                <p className="text-[13px] text-ink-3">ลงทะเบียนใบหน้าก่อน แล้วจึงสแกนเริ่มรอบเรียนได้</p>
              )}
            </Card>
          }
          exam={
            view.state === "ready" ? (
              <ScanFlow mode={mode} purpose="exam" assignmentId={view.assignment.id} label="สแกนใบหน้า · เริ่มสอบ" confirmedScanId={confirmedExam} />
            ) : undefined
          }
        />
      )}

      {view.attempts.length > 0 && (
        <Card>
          <SectionTitle className="mb-3">ผลสอบที่ผ่านมา</SectionTitle>
          <ul className="divide-y divide-line text-[13px]">
            {view.attempts.map((t, i) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2 py-2.5">
                ครั้งที่ {i + 1}
                {t.kind === "delta" ? " (ส่วนที่เปลี่ยน)" : ""} · {t.scorePercent}% <Badge tone={t.passed ? "success" : "danger"} label={t.passed ? "ผ่าน" : "ไม่ผ่าน"} />
                <span className="text-ink-3">{REASON[t.endReason ?? ""] ?? ""}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </main>
  );
}
