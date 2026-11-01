import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, Card, FIELD_LABEL_CLASS, INPUT_CLASS, PageHeader, SectionTitle, SELECT_CLASS } from "@/components/ui";
import { audienceOptions } from "@/domain/audience";
import { LEVEL_LABELS, TOPIC_LABELS } from "@/domain/blueprint";
import { aiReadable } from "@/domain/document";
import type { Level, Topic } from "@/db/schema";
import { assignmentStatus, audienceRulesOf, previewAudience, type AssignmentState } from "@/lib/assignment-service";
import { examEditor } from "@/lib/exam-service";
import { firstParam, pageActor } from "@/lib/page";
import { canEditDraft, canEditVersion, getSetDetail, type QuestionView } from "@/lib/set-service";
import { formatBangkok } from "@/lib/time";
import { fetchOrg } from "@/lib/workid";
import {
  approveAction,
  approveVersionAction,
  editQuestionAction,
  editSummaryAction,
  generateDeltaAction,
  generateExamsAction,
  regenerateQuestionAction,
  removeDocumentAction,
  returnAction,
  returnVersionAction,
  setAudienceAction,
  setChangeKindAction,
  startVersionAction,
  submitAction,
  submitVersionAction,
  summarizeVersionAction,
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
  // เอกสาร/ข้อสอบแก้ได้ทั้งตอนร่างของชุด และตอนทำเวอร์ชันใหม่ของชุดที่ใช้อยู่ (spec §7)
  const docsEditable = canEditVersion(actor, set, version);
  const editor = examEditor(actor, set, version);
  const newVersion = set.status === "active" && version && version.versionNo > 1 && !version.approvedAt ? version : null;
  const isOwner = actor.role === "admin" || actor.personId === set.authorPersonId;
  const isVersionApprover = Boolean(newVersion?.submittedAt) && set.approverPersonId === actor.personId;
  const isApprover = set.status === "pending_approval" && set.approverPersonId === actor.personId;
  const org = editable ? await fetchOrg() : null;
  const rules = await audienceRulesOf(set.id);
  const preview = editable ? await previewAudience(set.id) : null;
  const status = set.status === "active" || set.status === "closed" ? await assignmentStatus(set.id) : [];

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
        <SectionTitle className="mb-3">
          เอกสารต้นทาง{version?.label ? ` · ${version.label}` : ""}
          {newVersion && <span className="ml-2 text-[12px] font-normal text-warning">เวอร์ชันที่ {newVersion.versionNo} (ยังไม่อนุมัติ — ผู้เรียนยังใช้เวอร์ชันเดิม)</span>}
        </SectionTitle>
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
                {docsEditable && (
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
        {docsEditable && <UploadForm setId={set.id} allowPricelist={set.kind === "product"} />}
      </Card>

      <Card>
        <SectionTitle
          className="mb-3"
          right={
            docsEditable && (
              <form action={generateExamsAction}>
                <input type="hidden" name="setId" value={set.id} />
                <Button type="submit" variant={forms.some((f) => f.kind === "full") ? "secondary" : "primary"}>
                  {forms.some((f) => f.kind === "full") ? "ให้ AI ออกใหม่ทั้ง 5 ชุด" : "ให้ AI ออกข้อสอบ"}
                </Button>
              </form>
            )
          }
        >
          ข้อสอบ ({forms.length} ชุด)
        </SectionTitle>
        {docsEditable && forms.length === 0 && (
          <p className="text-[13px] text-ink-3">อัปเอกสาร PDF แล้วกดให้ AI ออกข้อสอบ — ใช้เวลาหลายนาที อย่าปิดหน้านี้</p>
        )}
        <div className="space-y-3">
          {forms.map((f) => (
            <details key={f.id} className="rounded-lg border border-line" open={forms.length === 1}>
              <summary className="cursor-pointer px-4 py-2 text-[13px] font-semibold">
                {f.kind === "delta" ? "ส่วนที่เปลี่ยน · " : ""}ชุดที่ {f.formNo} · {f.questions.length} ข้อ
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

      {set.status === "active" && (isOwner || isVersionApprover || set.approverPersonId === actor.personId) && (
        <VersionCard
          setId={set.id}
          version={version}
          newVersion={newVersion}
          isOwner={isOwner}
          isVersionApprover={isVersionApprover}
          docsEditable={docsEditable}
          approverName={set.approverName}
          hasDelta={forms.some((f) => f.kind === "delta")}
        />
      )}

      <AudienceCard
        setId={set.id}
        editable={editable}
        rules={rules}
        options={org?.ok ? audienceOptions(org.people) : null}
        preview={preview}
      />

      {status.length > 0 && (
        <Card>
          <SectionTitle className="mb-3">
            ผู้เรียน ({status.filter((s) => s.state === "passed").length}/{status.length} ผ่านแล้ว)
          </SectionTitle>
          <ul className="divide-y divide-line text-[13px]">
            {status.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <span>
                  {a.personName}
                  {a.source === "onboarding" && <span className="ml-1 text-[11px] text-ink-3">(Onboarding)</span>}
                </span>
                <span className="text-ink-3">
                  สอบ {a.attempts} ครั้ง · ส่งภายใน {formatBangkok(a.dueAt)} · <Badge tone={STATE[a.state].tone} label={STATE[a.state].label} />
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

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

type VersionRow = NonNullable<Awaited<ReturnType<typeof getSetDetail>>>["version"];

/** เวอร์ชันใหม่ของชุดที่ใช้อยู่ (spec §7 · ADR-0008) — ผู้สร้างเริ่ม/สรุป/ส่ง · ผู้อนุมัติเลือกเล็ก/ใหญ่ แล้วอนุมัติ */
function VersionCard({
  setId,
  version,
  newVersion,
  isOwner,
  isVersionApprover,
  docsEditable,
  approverName,
  hasDelta,
}: {
  setId: number;
  version: VersionRow;
  newVersion: VersionRow;
  isOwner: boolean;
  isVersionApprover: boolean;
  docsEditable: boolean;
  approverName: string | null;
  hasDelta: boolean;
}) {
  return (
    <Card>
      <SectionTitle className="mb-3">เวอร์ชันของเอกสาร</SectionTitle>
      {!newVersion && (
        <>
          <p className="mb-3 text-[13px] text-ink-3">
            ใช้อยู่: เวอร์ชันที่ {version?.versionNo ?? 1}
            {version?.label ? ` · ${version.label}` : ""} — เอกสารเปลี่ยน (ราคา รุ่น เงื่อนไข) ให้เริ่มเวอร์ชันใหม่ ผู้เรียนยังใช้ของเดิมจนกว่าจะอนุมัติ
          </p>
          {isOwner && (
            <form action={startVersionAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="setId" value={setId} />
              <label>
                <span className={FIELD_LABEL_CLASS}>ป้ายเวอร์ชันตามเอกสาร</span>
                <input name="label" placeholder="เช่น V.4 · 12/2026" className={INPUT_CLASS} />
              </label>
              <Button type="submit">เริ่มเวอร์ชันใหม่</Button>
            </form>
          )}
        </>
      )}
      {newVersion && (
        <div className="space-y-4 text-[13px]">
          <p className="text-ink-3">
            เวอร์ชันที่ {newVersion.versionNo}
            {newVersion.label ? ` · ${newVersion.label}` : ""} ·{" "}
            {newVersion.submittedAt ? `รออนุมัติจาก ${approverName ?? "-"}` : "ร่าง — อัปเอกสาร · ให้ AI ออกข้อสอบ 5 ชุด · สรุปสิ่งที่เปลี่ยน แล้วส่ง"}
          </p>
          <div>
            <p className="mb-1 font-semibold">สิ่งที่เปลี่ยน (ผู้เรียนที่ผ่านแล้วอ่านส่วนนี้)</p>
            {docsEditable ? (
              <form action={editSummaryAction} className="space-y-2">
                <input type="hidden" name="setId" value={setId} />
                <textarea name="summary" rows={5} defaultValue={newVersion.changeSummary ?? ""} placeholder="- ราคา F331 เปลี่ยนจาก … เป็น …" className={INPUT_CLASS} />
                <Button type="submit" size="sm" variant="secondary">
                  บันทึกสรุป
                </Button>
              </form>
            ) : (
              <div className="whitespace-pre-line rounded-lg bg-surface-2 px-3 py-2 text-ink-2">{newVersion.changeSummary ?? "—"}</div>
            )}
          </div>
          {docsEditable && (
            <div className="flex flex-wrap gap-2">
              <form action={summarizeVersionAction}>
                <input type="hidden" name="setId" value={setId} />
                <Button type="submit" variant="secondary">
                  ให้ AI สรุปสิ่งที่เปลี่ยน
                </Button>
              </form>
              <form action={submitVersionAction}>
                <input type="hidden" name="setId" value={setId} />
                <Button type="submit" variant="primary">
                  ส่งเวอร์ชันใหม่ขออนุมัติ
                </Button>
              </form>
            </div>
          )}
          {isVersionApprover && (
            <div className="space-y-4">
              <form action={setChangeKindAction} className="space-y-1">
                <input type="hidden" name="setId" value={setId} />
                <p className="font-semibold">เปลี่ยนแค่ไหน</p>
                <label className="flex items-center gap-2">
                  <input type="radio" name="kind" value="small" defaultChecked={newVersion.changeKind === "small"} required />
                  เปลี่ยนเล็ก (ราคาบางรุ่น · แก้คำผิด) — ผู้เรียนที่ผ่านแล้วกดรับทราบ
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="kind" value="large" defaultChecked={newVersion.changeKind === "large"} />
                  เปลี่ยนใหญ่ (Series ใหม่ · เงื่อนไขการขาย) — ผู้เรียนที่ผ่านแล้วสอบส่วนที่เปลี่ยน
                </label>
                <Button type="submit" size="sm" variant="secondary">
                  บันทึก
                </Button>
              </form>
              {newVersion.changeKind === "large" && (
                <form action={generateDeltaAction}>
                  <input type="hidden" name="setId" value={setId} />
                  <Button type="submit" variant="secondary">
                    {hasDelta ? "ให้ AI ออกข้อสอบส่วนที่เปลี่ยนใหม่" : "ให้ AI ออกข้อสอบส่วนที่เปลี่ยน (5 ชุด × 5 ข้อ)"}
                  </Button>
                </form>
              )}
              <form action={approveVersionAction}>
                <input type="hidden" name="setId" value={setId} />
                <Button type="submit" variant="primary">
                  อนุมัติเวอร์ชันใหม่
                </Button>
              </form>
              <form action={returnVersionAction} className="space-y-2">
                <input type="hidden" name="setId" value={setId} />
                <label className="block">
                  <span className={FIELD_LABEL_CLASS}>ตีกลับให้ผู้สร้าง</span>
                  <textarea name="comment" required rows={2} className={INPUT_CLASS} />
                </label>
                <Button type="submit" variant="danger">
                  ตีกลับ
                </Button>
              </form>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

const STATE: Record<AssignmentState, { label: string; tone: "success" | "info" | "neutral" | "danger" }> = {
  passed: { label: "ผ่านแล้ว", tone: "success" },
  started: { label: "เริ่มแล้ว", tone: "info" },
  not_started: { label: "ยังไม่เริ่ม", tone: "neutral" },
  overdue: { label: "เลยกำหนด", tone: "danger" },
};

type Rule = { kind: string; refId: number; label: string };
type Options = ReturnType<typeof audienceOptions>;

/** ผู้รับ (spec §5) — เลือกจากผังของ WorkID · เก็บเงื่อนไข ไม่ใช่รายชื่อ */
function AudienceCard({
  setId,
  editable,
  rules,
  options,
  preview,
}: {
  setId: number;
  editable: boolean;
  rules: Rule[];
  options: Options | null;
  preview: Awaited<ReturnType<typeof previewAudience>> | null;
}) {
  const has = (kind: string, id: number) => rules.some((r) => r.kind === kind && r.refId === id);
  const box = (kind: string, id: number, label: string, count: number) => (
    <label key={`${kind}:${id}`} className="flex items-center gap-2">
      <input type="checkbox" name="rule" value={`${kind}:${id}:${label}`} defaultChecked={has(kind, id)} />
      {label} <span className="text-ink-3">({count})</span>
    </label>
  );
  return (
    <Card>
      <SectionTitle className="mb-3">ผู้รับ</SectionTitle>
      {!editable && (
        <p className="text-[13px] text-ink-2">{rules.length ? rules.map((r) => r.label).join(" · ") : "ยังไม่ได้ตั้งผู้รับ"}</p>
      )}
      {editable && !options && <p className="text-[13px] text-danger">ดึงผังจาก WorkID ไม่ได้ — ตั้งผู้รับไม่ได้ตอนนี้</p>}
      {editable && options && (
        <form action={setAudienceAction} className="space-y-4 text-[13px]">
          <input type="hidden" name="setId" value={setId} />
          <fieldset>
            <legend className="mb-1 font-semibold">ตามตำแหน่ง</legend>
            {options.positions.length === 0 && <p className="text-ink-3">ยังไม่มีใครในผังที่มีรหัสตำแหน่งจาก WorkHR</p>}
            <div className="grid gap-1 sm:grid-cols-2">{options.positions.map((p) => box("position", p.id, p.label, p.count))}</div>
            {options.peopleWithoutPosition > 0 && (
              <p className="mt-1 text-[11px] text-warning">
                {options.peopleWithoutPosition} คนยังไม่มีรหัสตำแหน่งใน WorkID — จะไม่ติดเงื่อนไขตำแหน่งจนกว่า WorkHR จะเติมให้
              </p>
            )}
          </fieldset>
          <fieldset>
            <legend className="mb-1 font-semibold">ตามทีม</legend>
            <div className="grid gap-1 sm:grid-cols-2">{options.teams.map((t) => box("team", t.id, t.label, t.count))}</div>
          </fieldset>
          <fieldset>
            <legend className="mb-1 font-semibold">หัวหน้าที่ดูแลทีม</legend>
            <div className="grid gap-1 sm:grid-cols-2">{options.teams
                .filter((t) => options.managersByTeam.has(t.id))
                .map((t) => box("manages_team", t.id, `หัวหน้า ${t.label}`, options.managersByTeam.get(t.id) ?? 0))}</div>
          </fieldset>
          <Button type="submit">บันทึกผู้รับ</Button>
        </form>
      )}
      {preview && (
        <p className="mt-3 text-[12px] text-ink-3">
          {preview.ok
            ? `ตอนนี้ตรงเงื่อนไข ${preview.people.length} คน${preview.people.length ? `: ${preview.people.map((p) => p.name).join(", ")}` : ""}`
            : preview.error}
        </p>
      )}
    </Card>
  );
}
