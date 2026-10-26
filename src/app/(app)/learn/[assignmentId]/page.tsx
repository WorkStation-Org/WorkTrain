import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, Card, PageHeader, SectionTitle } from "@/components/ui";
import { confirmedScanFor, enrollmentState, scanMode } from "@/lib/identity-service";
import { learnView } from "@/lib/learn-service";
import { firstParam, learnerActor } from "@/lib/page";
import { formatBangkok } from "@/lib/time";
import { endStudyAction } from "../actions";
import { ScanFlow } from "../scan-flow";
import { Reader } from "./reader";

export const dynamic = "force-dynamic";

const REASON: Record<string, string> = { submitted: "ส่งเอง", timeout: "หมดเวลา", left_page: "ออกจากหน้าสอบครบ 5 ครั้ง" };

/** หน้าเรียนของการมอบหนึ่ง — สแกนเริ่มรอบ → อ่านครบทุกหน้า → สแกนเริ่มสอบ (spec §9 · §10) */
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
  const readCount = view.documents.filter((d) => d.completed).length;
  const mode = scanMode();
  const enrolled = (await enrollmentState(actor.personId)).state === "active";
  const confirmedStudy = await confirmedScanFor(actor.personId, "study");
  const confirmedExam = await confirmedScanFor(actor.personId, "exam");

  return (
    <main className="mx-auto max-w-4xl space-y-5 px-4 py-8">
      <PageHeader
        title={view.set.title}
        subtitle={`${view.versionLabel ? `${view.versionLabel} · ` : ""}กำหนดส่ง ${formatBangkok(view.assignment.dueAt)} · ผ่าน ${view.set.passPercent}% · สอบ ${view.set.examMinutes} นาที`}
        actions={<Link href="/learn" className="text-[13px] text-ink-3 underline">ชุดทั้งหมด</Link>}
      />
      {err && <p className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">{err}</p>}

      {!enrolled && view.state !== "passed" && (
        <p className="rounded-lg bg-warning-soft px-3 py-2 text-[13px] text-warning">
          ต้องลงทะเบียนใบหน้าก่อนเริ่มเรียน —{" "}
          <Link href="/enroll" className="font-semibold underline">
            ลงทะเบียนใบหน้า
          </Link>
        </p>
      )}

      {view.state === "passed" && <p className="rounded-lg bg-success-soft px-3 py-2 text-[14px] text-success">สอบผ่านชุดนี้แล้ว 🎉</p>}
      {view.state === "relearn" && (
        <p className="rounded-lg bg-warning-soft px-3 py-2 text-[13px] text-warning">สอบไม่ผ่าน 2 ครั้งติด — อ่านเอกสารให้ครบทุกหน้าอีกรอบก่อนสอบใหม่</p>
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
        <Card>
          <SectionTitle
            className="mb-3"
            right={
              view.session ? (
                <form action={endStudyAction}>
                  <input type="hidden" name="assignmentId" value={view.assignment.id} />
                  <Button type="submit" size="sm" variant="ghost">
                    จบรอบเรียน
                  </Button>
                </form>
              ) : null
            }
          >
            เอกสาร ({readCount}/{view.documents.length} อ่านครบ)
          </SectionTitle>
          {view.session ? (
            <Reader assignmentId={view.assignment.id} documents={view.documents} />
          ) : enrolled ? (
            <div>
              <p className="mb-3 text-[13px] text-ink-3">
                สแกนใบหน้าเพื่อเริ่มรอบเรียน · นิ่งเกิน 2 นาทีรอบจะจบ ต้องสแกนใหม่ (หน้าที่อ่านแล้วยังนับอยู่)
              </p>
              <ScanFlow mode={mode} purpose="study" label="สแกนใบหน้า · เริ่มเรียน" confirmedScanId={confirmedStudy} />
            </div>
          ) : null}
        </Card>
      )}

      {view.state === "ready" && (
        <Card>
          <SectionTitle className="mb-3">สอบ</SectionTitle>
          <p className="mb-3 text-[13px] text-ink-3">
            10 ข้อ · {view.set.examMinutes} นาที · ทีละข้อ ย้อนกลับไม่ได้ · เปิดเอกสารไม่ได้ระหว่างสอบ · ออกจากหน้าสอบครบ 5 ครั้ง = ส่งเอง
          </p>
          <ScanFlow
            mode={mode}
            purpose="exam"
            assignmentId={view.assignment.id}
            label="สแกนใบหน้า · เริ่มสอบ"
            confirmedScanId={confirmedExam}
          />
        </Card>
      )}

      {view.attempts.length > 0 && (
        <Card>
          <SectionTitle className="mb-3">ผลสอบที่ผ่านมา</SectionTitle>
          <ul className="space-y-1 text-[13px]">
            {view.attempts.map((t, i) => (
              <li key={t.id} className="flex items-center gap-2">
                ครั้งที่ {i + 1} · {t.scorePercent}% <Badge tone={t.passed ? "success" : "danger"} label={t.passed ? "ผ่าน" : "ไม่ผ่าน"} />
                <span className="text-ink-3">{REASON[t.endReason ?? ""] ?? ""}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </main>
  );
}
