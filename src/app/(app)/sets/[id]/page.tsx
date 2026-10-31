import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, Card, FIELD_LABEL_CLASS, INPUT_CLASS, PageHeader, SectionTitle, SELECT_CLASS } from "@/components/ui";
import { LEVEL_LABELS, TOPIC_LABELS } from "@/domain/blueprint";
import { aiReadable } from "@/domain/document";
import type { Level, Topic } from "@/db/schema";
import { examEditor } from "@/lib/exam-service";
import { firstParam, pageActor } from "@/lib/page";
import { canEditDraft, getSetDetail, type QuestionView } from "@/lib/set-service";
import { formatBangkok } from "@/lib/time";
import { fetchOrg } from "@/lib/workid";
import {
  approveAction,
  editQuestionAction,
  generateExamsAction,
  regenerateQuestionAction,
  removeDocumentAction,
  returnAction,
  submitAction,
  updateSettingsAction,
} from "../actions";
import { Flash, STATUS } from "../ui";
import { UploadForm } from "./upload-form";

export const dynamic = "force-dynamic";
/** AI อ่านแคตตาล็อก ~20 หน้าแล้วออก 50 ข้อในคำขอเดียว — ใช้เวลาหลายนาที (server action ใช้ค่านี้ของหน้า) */
export const maxDuration = 300;

const EVENT_LABELS: Record<string, string> = {
  submitted: "ส่งขออนุมัติ",
  approved: "อนุมัติ",
  returned: "ตีกลับ",
  question_edited: "แก้ข้อสอบ",
  question_regenerated: "ให้ AI ออกข้อใหม่",
  approver_changed: "เปลี่ยนผู้อนุมัติ",
};

export default async function SetPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await pageActor();
  const setId = Number.parseInt((await params).id, 10);
  const detail = Number.isInteger(setId) ? await getSetDetail(actor, setId) : null;
  if (!detail) notFound();
  const sp = await searchParams;
  const { set, version, documents, forms, events } = detail;
  const editable = canEditDraft(actor, set);
  const editor = examEditor(actor, set);
  const isApprover = set.status === "pending_approval" && set.approverPersonId === actor.personId;
  const org = editable ? await fetchOrg() : null;

  return (
    <main className="mx-auto max-w-4xl space-y-5 px-4 py-8">
      <PageHeader
        title={set.title}
        subtitle={`${set.kind === "product" ? "สินค้าใหม่ (PD)" : "ทั่วไป"} · ผู้สร้าง ${set.authorName} · ผู้อนุมัติ ${set.approverName ?? "ยังไม่ได้เลือก"}`}
        actions={
          <>
            <Badge tone={STATUS[set.status].tone} label={STATUS[set.status].label} />
            <Link href="/sets" className="text-[13px] text-ink-3 underline">
              ชุดทั้งหมด
            </Link>
          </>
        }
      />
      <Flash msg={firstParam(sp.msg)} err={firstParam(sp.err)} />

      {editable && (
        <Card>
          <SectionTitle className="mb-3">ตั้งค่า</SectionTitle>
          <form action={updateSettingsAction} className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="setId" value={set.id} />
            <label className="sm:col-span-2">
              <span className={FIELD_LABEL_CLASS}>ชื่อชุด</span>
              <input name="title" defaultValue={set.title} required maxLength={200} className={INPUT_CLASS} />
            </label>
            <label>
              <span className={FIELD_LABEL_CLASS}>เวอร์ชันตามเอกสาร</span>
              <input name="label" defaultValue={version?.label ?? ""} placeholder="เช่น V.1 · 10/2026" className={INPUT_CLASS} />
            </label>
            <label>
              <span className={FIELD_LABEL_CLASS}>ผู้อนุมัติ</span>
              <select name="approverPersonId" defaultValue={set.approverPersonId ?? ""} className={SELECT_CLASS}>
                <option value="">— เลือก —</option>
                {org?.ok &&
                  org.people
                    .filter((p) => p.personId !== set.authorPersonId)
                    .map((p) => (
                      <option key={p.personId} value={p.personId}>
                        {p.fullName}
                        {p.title ? ` · ${p.title}` : ""}
                      </option>
                    ))}
              </select>
              {org && !org.ok && <span className="text-[11px] text-danger">ดึงผังจาก WorkID ไม่ได้ — ผู้อนุมัติเดิมยังอยู่</span>}
            </label>
            <label>
              <span className={FIELD_LABEL_CLASS}>กำหนดส่ง (วันหลังได้รับมอบ)</span>
              <input name="dueDays" type="number" min={1} max={90} defaultValue={set.dueDays} className={INPUT_CLASS} />
            </label>
            <label>
              <span className={FIELD_LABEL_CLASS}>เวลาสอบ (นาที)</span>
              <input name="examMinutes" type="number" min={1} max={120} defaultValue={set.examMinutes} className={INPUT_CLASS} />
            </label>
            <div className="sm:col-span-2">
              <Button type="submit">บันทึก</Button>
            </div>
          </form>
        </Card>
      )}

      <Card>
        <SectionTitle className="mb-3">เอกสารต้นทาง{version?.label ? ` · ${version.label}` : ""}</SectionTitle>
        {documents.length === 0 ? (
          <p className="text-[13px] text-ink-3">ยังไม่มีเอกสาร</p>
        ) : (
          <ul className="mb-4 divide-y divide-line">
            {documents.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[13px]">
                <span>
                  {d.fileName} <span className="text-ink-3">· {d.kind} · {(d.sizeBytes / 1024 / 1024).toFixed(1)} MB</span>
                  {!aiReadable(d.mimeType) && <span className="ml-2 text-warning">AI ยังอ่านไฟล์ชนิดนี้ไม่ได้</span>}
                </span>
                {editable && (
                  <form action={removeDocumentAction}>
                    <input type="hidden" name="setId" value={set.id} />
                    <input type="hidden" name="documentId" value={d.id} />
                    <button type="submit" className="text-[12px] text-danger underline">
                      ลบ
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
        {editable && <UploadForm setId={set.id} allowPricelist={set.kind === "product"} />}
      </Card>

      <Card>
        <SectionTitle
          className="mb-3"
          right={
            editable && (
              <form action={generateExamsAction}>
                <input type="hidden" name="setId" value={set.id} />
                <Button type="submit" variant={forms.length ? "secondary" : "primary"}>
                  {forms.length ? "ให้ AI ออกใหม่ทั้ง 5 ชุด" : "ให้ AI ออกข้อสอบ"}
                </Button>
              </form>
            )
          }
        >
          ข้อสอบ ({forms.length} ชุด)
        </SectionTitle>
        {editable && forms.length === 0 && (
          <p className="text-[13px] text-ink-3">อัปเอกสาร PDF แล้วกดให้ AI ออกข้อสอบ — ใช้เวลาหลายนาที อย่าปิดหน้านี้</p>
        )}
        <div className="space-y-3">
          {forms.map((f) => (
            <details key={f.id} className="rounded-lg border border-line" open={forms.length === 1}>
              <summary className="cursor-pointer px-4 py-2 text-[13px] font-semibold">
                ชุดที่ {f.formNo} · {f.questions.length} ข้อ
                {f.questions.some((q) => q.priceCheck === "mismatch") && <span className="ml-2 text-danger">ราคาไม่ตรง Pricelist</span>}
              </summary>
              <ol className="divide-y divide-line">
                {f.questions.map((q, i) => (
                  <QuestionItem key={q.id} setId={set.id} q={q} no={i + 1} canEdit={editor !== null} />
                ))}
              </ol>
            </details>
          ))}
        </div>
      </Card>

      {(editable || isApprover) && (
        <Card>
          <SectionTitle className="mb-3">{isApprover ? "การอนุมัติ" : "ส่งขออนุมัติ"}</SectionTitle>
          {editable && (
            <form action={submitAction}>
              <input type="hidden" name="setId" value={set.id} />
              <p className="mb-3 text-[13px] text-ink-3">ส่งให้ {set.approverName ?? "(ยังไม่ได้เลือกผู้อนุมัติ)"} ตรวจข้อสอบทั้ง 5 ชุด</p>
              <Button type="submit" variant="primary">
                ส่งขออนุมัติ
              </Button>
            </form>
          )}
          {isApprover && (
            <div className="space-y-4">
              <form action={approveAction}>
                <input type="hidden" name="setId" value={set.id} />
                <p className="mb-3 text-[13px] text-ink-3">แก้ข้อที่ไม่ถูกต้องได้ในส่วนข้อสอบด้านบน แล้วกดอนุมัติ</p>
                <Button type="submit" variant="primary">
                  อนุมัติ
                </Button>
              </form>
              <form action={returnAction} className="space-y-2">
                <input type="hidden" name="setId" value={set.id} />
                <label className="block">
                  <span className={FIELD_LABEL_CLASS}>ตีกลับให้ผู้สร้าง (เช่น Pricelist หรือแคตตาล็อกผิด)</span>
                  <textarea name="comment" required rows={2} className={INPUT_CLASS} />
                </label>
                <Button type="submit" variant="danger">
                  ตีกลับ
                </Button>
              </form>
            </div>
          )}
        </Card>
      )}

      {events.length > 0 && (
        <Card>
          <SectionTitle className="mb-3">ประวัติ</SectionTitle>
          <ul className="space-y-1 text-[13px]">
            {events.map((e) => (
              <li key={e.id}>
                <span className="text-ink-3">{formatBangkok(e.createdAt)}</span> · {e.actorName} · {EVENT_LABELS[e.action] ?? e.action}
                {e.comment && <span className="text-ink-2"> — {e.comment}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </main>
  );
}

function QuestionItem({ setId, q, no, canEdit }: { setId: number; q: QuestionView; no: number; canEdit: boolean }) {
  return (
    <li className="px-4 py-3 text-[13px]">
      <p className="mb-1 text-[11px] text-ink-3">
        {TOPIC_LABELS[q.topic as Topic]} · {LEVEL_LABELS[q.level as Level]} · ที่มา {q.sourceRef}
      </p>
      <p className="font-medium text-ink">
        {no}. {q.text}
      </p>
      <ul className="mt-1 space-y-0.5">
        {q.choices.map((c) => (
          <li key={c.id} className={c.isCorrect ? "font-semibold text-success" : "text-ink-2"}>
            {c.isCorrect ? "✓ " : "· "}
            {c.text}
          </li>
        ))}
      </ul>
      {canEdit && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[12px] text-ink-3 underline">แก้ข้อนี้</summary>
          <form action={editQuestionAction} className="mt-2 space-y-2">
            <input type="hidden" name="setId" value={setId} />
            <input type="hidden" name="questionId" value={q.id} />
            <textarea name="text" defaultValue={q.text} required rows={2} className={INPUT_CLASS} />
            {[0, 1, 2, 3].map((i) => (
              <label key={i} className="flex items-center gap-2">
                <input type="radio" name="correctIndex" value={i} defaultChecked={q.choices[i]?.isCorrect} required />
                <input name={`choice${i}`} defaultValue={q.choices[i]?.text ?? ""} required className={INPUT_CLASS} />
              </label>
            ))}
            <input name="sourceRef" defaultValue={q.sourceRef} required placeholder="ที่มาในเอกสาร" className={INPUT_CLASS} />
            <Button type="submit" size="sm">
              บันทึกข้อนี้
            </Button>
          </form>
          <form action={regenerateQuestionAction} className="mt-2">
            <input type="hidden" name="setId" value={setId} />
            <input type="hidden" name="questionId" value={q.id} />
            <Button type="submit" size="sm" variant="ghost">
              ให้ AI ออกข้อนี้ใหม่
            </Button>
          </form>
        </details>
      )}
    </li>
  );
}
