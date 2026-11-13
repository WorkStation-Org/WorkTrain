import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, Card, FIELD_LABEL_CLASS, INPUT_CLASS, PageHeader, SectionTitle } from "@/components/ui";
import { LEVEL_LABELS, slots, topicLabel, topicsOf, type Blueprint } from "@/domain/blueprint";
import { aiReadable, isVideoMime } from "@/domain/document";
import { coverage } from "@/domain/spread";
import { FORMS_PER_VERSION, type Level } from "@/db/schema";
import { assignmentStatus, audienceRulesOf, type AssignmentState } from "@/lib/assignment-service";
import { examEditor, reviewedQuestionIds } from "@/lib/exam-service";
import { firstParam, pageActor } from "@/lib/page";
import { canCloseSet, canDeleteDraft, canEditAudience, canEditDraft, canEditVersion, canManage, coverPath, getSetDetail } from "@/lib/set-service";
import { formatBangkok } from "@/lib/time";
import { fetchOrg } from "@/lib/workid";
import {
  approveAction,
  approveVersionAction,
  editSummaryAction,
  generateDeltaAction,
  generateExamsAction,
  returnAction,
  returnVersionAction,
  setChangeKindAction,
  startVersionAction,
  submitAction,
  submitVersionAction,
  summarizeVersionAction,
  updateSettingsAction,
} from "../actions";
import { EndSetButton } from "../end-set-button";
import { Flash, STATUS } from "../ui";
import { ApproverPicker } from "./approver-picker";
import { AudiencePicker } from "./audience-picker";
import { DocsManager } from "./docs-manager";
import { ExamImport } from "./exam-import";
import { ExamWorkspace } from "./exam-workspace";
import { SpreadPanel } from "./spread-panel";

export const dynamic = "force-dynamic";
/** AI อ่านแคตตาล็อก ~20 หน้าแล้วออก 50 ข้อในคำขอเดียว — ใช้เวลาหลายนาที (server action ใช้ค่านี้ของหน้า) */
export const maxDuration = 300;

const EVENT_LABELS: Record<string, string> = {
  submitted: "ส่งขออนุมัติ",
  approved: "อนุมัติ",
  returned: "ตีกลับ",
  question_edited: "แก้ข้อสอบ",
  question_regenerated: "ให้ AI ออกข้อใหม่",
  exams_generated: "ให้ AI ออกข้อสอบ 5 ชุด",
  exams_imported: "Import ข้อสอบ 5 ชุด",
  approver_changed: "เปลี่ยนผู้อนุมัติ",
  audience_changed: "เปลี่ยนผู้รับ",
  deleted: "ลบร่าง",
  closed: "ปิดชุด",
};

type Tab = "settings" | "docs" | "exam" | "audience" | "learners" | "history";
const TABS: Tab[] = ["settings", "docs", "exam", "audience", "learners", "history"];

/**
 * หน้าชุดการเรียนรู้ — แถบขั้นตอน ตั้งค่า → เอกสาร → ข้อสอบ → ผู้รับ (→ ผู้เรียน) → ประวัติ · แต่ละขั้นบอกสถานะในตัว
 * แสดงทีละขั้นตาม `?tab=` — บันทึกแล้วกลับมาขั้นเดิม (action ส่ง `tab` กลับมา) ไม่ต้องเลื่อนหาใหม่
 */
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
  const audienceEditable = canEditAudience(actor, set);
  const rules = await audienceRulesOf(set.id);
  const status = set.status === "active" || set.status === "closed" ? await assignmentStatus(set.id) : [];
  const fullForms = forms.filter((f) => f.kind === "full");
  const allQuestions = forms.flatMap((f) => f.questions);
  const reviewed = version ? await reviewedQuestionIds(version.id, actor.personId) : new Set<number>();
  const reviewedCount = allQuestions.filter((q) => reviewed.has(q.id)).length;
  const canReview = canManage(actor, set);
  const videos = documents.filter((d) => isVideoMime(d.mimeType));
  const aiDocs = documents.filter((d) => aiReadable(d.mimeType));

  const requested = firstParam(sp.tab) as Tab | undefined;
  const fallback: Tab =
    isApprover || isVersionApprover
      ? "exam"
      : status.length
        ? "learners"
        : documents.length === 0
          ? "docs"
          : fullForms.length === 0
            ? "exam"
            : rules.length === 0
              ? "audience"
              : "exam";
  const tab: Tab = requested && TABS.includes(requested) && (requested !== "learners" || status.length > 0) ? requested : fallback;
  const needOrg = (tab === "settings" && editable) || tab === "audience";
  const org = needOrg ? await fetchOrg() : null;

  const steps: { key: Tab; label: string; sub: string; state: "done" | "todo" | "warn" | "info" }[] = [
    { key: "settings", label: "ตั้งค่า", sub: set.approverName ? `ผู้อนุมัติ ${set.approverName}` : "ยังไม่เลือกผู้อนุมัติ", state: set.approverName ? "done" : "warn" },
    {
      key: "docs",
      label: "เอกสาร",
      sub: documents.length ? [videos.length && `${videos.length} วิดีโอ`, documents.length - videos.length && `${documents.length - videos.length} เอกสาร`].filter(Boolean).join(" · ") : "ยังไม่มี",
      state: documents.length ? "done" : "warn",
    },
    {
      key: "exam",
      label: "ข้อสอบ",
      sub: allQuestions.length ? (canReview ? `ตรวจแล้ว ${reviewedCount}/${allQuestions.length}` : `${forms.length} ชุด`) : "ยังไม่ออก",
      state: !allQuestions.length ? "warn" : canReview && reviewedCount < allQuestions.length ? "warn" : "done",
    },
    { key: "audience", label: "ผู้รับ", sub: rules.length ? `${rules.length} เงื่อนไข` : "ยังไม่ตั้ง", state: rules.length ? "done" : "warn" },
    ...(status.length
      ? [{ key: "learners" as const, label: "ผู้เรียน", sub: `ผ่าน ${status.filter((s) => s.state === "passed").length}/${status.length}`, state: "info" as const }]
      : []),
    { key: "history", label: "ประวัติ", sub: `${events.length} รายการ`, state: "info" },
  ];

  const people = org?.ok ? org.people : [];
  const author = people.find((p) => p.personId === set.authorPersonId);

  return (
    <main className="mx-auto w-full max-w-6xl space-y-5">
      <PageHeader
        kicker="Learning set"
        title={set.title}
        subtitle={`${detail.kind.name}${version?.label ? ` · ${version.label}` : ""} · ผู้สร้าง ${set.authorName} · ผู้อนุมัติ ${set.approverName ?? "ยังไม่ได้เลือก"}`}
        actions={
          <>
            <Badge tone={STATUS[set.status].tone} label={STATUS[set.status].label} />
            {canDeleteDraft(actor, set) && <EndSetButton setId={set.id} title={set.title} mode="delete" tab={tab} />}
            {canCloseSet(actor, set) && <EndSetButton setId={set.id} title={set.title} mode="close" tab={tab} />}
            {editable && (
              <form action={submitAction}>
                <input type="hidden" name="setId" value={set.id} />
                <input type="hidden" name="tab" value={tab} />
                <Button type="submit" variant="primary">
                  ส่งขออนุมัติ
                </Button>
              </form>
            )}
            <Button href="/sets" variant="ghost" icon="chevronLeft">
              ชุดทั้งหมด
            </Button>
          </>
        }
      />

      <nav aria-label="ขั้นตอนของชุด" className="-mx-1 flex gap-0.5 overflow-x-auto border-b border-line px-1">
        {steps.map((s, i) => (
          <Link
            key={s.key}
            href={`/sets/${set.id}?tab=${s.key}`}
            aria-current={tab === s.key ? "step" : undefined}
            scroll={false}
            className={`flex min-h-14 shrink-0 items-center gap-2.5 border-b-[3px] px-3.5 pb-2.5 pt-2 ${tab === s.key ? "border-fg" : "border-transparent hover:border-line-strong"}`}
          >
            <span
              className={`flex size-6 shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${
                s.state === "done" ? "bg-success-soft text-success" : s.state === "warn" ? "bg-warn-soft text-warn" : "bg-subtle text-ink-2"
              }`}
            >
              {s.state === "done" ? "✓" : s.state === "info" ? "·" : i + 1}
            </span>
            <span className="flex flex-col text-left">
              <span className="text-[14px] font-semibold text-fg">{s.label}</span>
              <span className={`text-[12px] ${s.state === "warn" ? "text-warn" : "text-muted"}`}>{s.sub}</span>
            </span>
          </Link>
        ))}
      </nav>

      <Flash msg={firstParam(sp.msg)} err={firstParam(sp.err)} />

      {tab === "settings" &&
        (editable ? (
          <Card>
            <form action={updateSettingsAction} className="grid gap-4 sm:grid-cols-2">
              <input type="hidden" name="setId" value={set.id} />
              <input type="hidden" name="tab" value="settings" />
              <label className="sm:col-span-2">
                <span className={FIELD_LABEL_CLASS}>ชื่อชุด</span>
                <input name="title" defaultValue={set.title} required maxLength={200} className={INPUT_CLASS} />
              </label>
              <label>
                <span className={FIELD_LABEL_CLASS}>เวอร์ชันตามเอกสาร</span>
                <input name="label" defaultValue={version?.label ?? ""} placeholder="เช่น V.1 · 10/2026" className={INPUT_CLASS} />
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
                <span className={FIELD_LABEL_CLASS}>ผู้อนุมัติ</span>
                {org && !org.ok ? (
                  <p className="text-[13px] text-danger">ดึงผังจาก WorkID ไม่ได้ — ผู้อนุมัติเดิมยังอยู่ ({set.approverName ?? "ยังไม่ได้เลือก"})</p>
                ) : (
                  <ApproverPicker
                    people={people
                      .filter((p) => p.personId !== set.authorPersonId)
                      .map((p) => ({ personId: p.personId, fullName: p.fullName, nickname: p.nickname, title: p.title, teamName: p.teamName }))}
                    initialId={set.approverPersonId}
                    managerId={author?.managerPersonId ?? null}
                  />
                )}
                {org && !org.ok && <input type="hidden" name="approverPersonId" value={set.approverPersonId ?? ""} />}
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" variant="primary">
                  บันทึก
                </Button>
              </div>
            </form>
          </Card>
        ) : (
          <Card>
            <dl className="grid gap-4 text-[13px] sm:grid-cols-2">
              <Item label="ชื่อชุด" value={set.title} />
              <Item label="เวอร์ชันตามเอกสาร" value={version?.label ?? "—"} />
              <Item label="กำหนดส่ง" value={`${set.dueDays} วันหลังได้รับมอบ`} />
              <Item label="เวลาสอบ" value={`${set.examMinutes} นาที · ผ่าน ${set.passPercent}%`} />
              <Item label="ผู้สร้าง" value={set.authorName} />
              <Item label="ผู้อนุมัติ" value={set.approverName ?? "ยังไม่ได้เลือก"} />
            </dl>
            <p className="mt-4 text-[12px] text-muted">ตั้งค่าแก้ได้ตอนชุดยังเป็นร่าง</p>
          </Card>
        ))}

      {tab === "docs" && (
        <div className="space-y-4">
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
          {newVersion && <p className="text-[13px] text-warn">เวอร์ชันที่ {newVersion.versionNo} (ยังไม่อนุมัติ — ผู้เรียนยังใช้เวอร์ชันเดิม)</p>}
          <DocsManager
            setId={set.id}
            docs={documents.map((d) => ({
              id: d.id,
              fileName: d.fileName,
              kind: d.kind,
              mimeType: d.mimeType,
              sizeBytes: d.sizeBytes,
              pageCount: d.pageCount,
              durationSeconds: d.durationSeconds,
              coverUrl: coverPath(d),
              examWeight: d.examWeight,
            }))}
            editable={docsEditable}
            canSetCover={isOwner}
            allowPricelist={detail.kind.allowPricelist}
            customWeights={set.spreadMode === "custom"}
          />
        </div>
      )}

      {tab === "exam" && (
        <div className="space-y-4">
          {/* แผนเฉลี่ยมีไว้สั่ง AI — ไม่มี PDF ให้ AI อ่าน (มีแต่วิดีโอ) ก็ไม่ต้องแสดง */}
          {aiDocs.length > 0 && (
            <SpreadPanel
              setId={set.id}
              mode={set.spreadMode}
              files={aiDocs.map((d) => ({ name: d.fileName, weight: d.examWeight }))}
              topics={topicsOf(set.blueprint as Blueprint).map(topicLabel)}
              perForm={slots(set.blueprint as Blueprint).length}
              formCount={FORMS_PER_VERSION}
              editable={docsEditable}
              coverage={
                fullForms.length
                  ? coverage(
                      fullForms.map((f) => f.questions),
                      aiDocs.map((d) => d.fileName),
                    )
                  : null
              }
            />
          )}
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="mr-auto text-[17px] font-semibold text-fg">ข้อสอบ ({forms.length} ชุด)</h2>
            {docsEditable && (
              <form action={generateExamsAction}>
                <input type="hidden" name="setId" value={set.id} />
                <input type="hidden" name="tab" value="exam" />
                <Button type="submit" variant={fullForms.length || !aiDocs.length ? "secondary" : "primary"}>
                  {fullForms.length ? "ให้ AI ออกใหม่ทั้ง 5 ชุด" : "ให้ AI ออกข้อสอบ"}
                </Button>
              </form>
            )}
            {docsEditable && documents.length > 0 && <ExamImport setId={set.id} kind="full" hasExisting={fullForms.length > 0} />}
          </div>
          {forms.length === 0 ? (
            <p className="rounded-[13px] border border-dashed border-line-strong px-4 py-8 text-center text-[13px] text-muted">
              {!docsEditable
                ? "ยังไม่มีข้อสอบ"
                : documents.length === 0
                  ? "อัปเอกสารก่อน แล้วให้ AI ออกข้อสอบ หรือกด Template กรอกเองแล้ว Import"
                  : aiDocs.length
                    ? "กดให้ AI ออกข้อสอบจาก PDF (ใช้เวลาหลายนาที อย่าปิดหน้านี้) หรือกด Template กรอกเองแล้ว Import"
                    : "AI อ่านได้เฉพาะ PDF — ชุดนี้มีแต่วิดีโอ ให้กด Template กรอกข้อสอบเองแล้ว Import"}
            </p>
          ) : (
            <ExamWorkspace
              setId={set.id}
              forms={forms.map((f) => ({
                id: f.id,
                formNo: f.formNo,
                delta: f.kind === "delta",
                questions: f.questions.map((q) => ({
                  id: q.id,
                  meta: `${topicLabel(q.topic)} · ${LEVEL_LABELS[q.level as Level]}`,
                  text: q.text,
                  sourceRef: q.sourceRef,
                  choices: q.choices.map((c) => ({ text: c.text, isCorrect: c.isCorrect })),
                  priceMismatch: q.priceCheck === "mismatch",
                })),
              }))}
              reviewedIds={[...reviewed]}
              canEdit={editor !== null}
              canReview={canReview}
              initialForm={Number(firstParam(sp.form)) || undefined}
            />
          )}
          {isApprover && (
            <Card>
              <SectionTitle className="mb-3">การอนุมัติ</SectionTitle>
              <div className="space-y-4">
                <form action={approveAction}>
                  <input type="hidden" name="setId" value={set.id} />
                  <input type="hidden" name="tab" value="exam" />
                  <p className="mb-3 text-[13px] text-ink-3">
                    คุณตรวจแล้ว {reviewedCount}/{allQuestions.length} ข้อ · แก้ข้อที่ไม่ถูกต้องได้ในการ์ดด้านบน แล้วกดอนุมัติ
                  </p>
                  <Button type="submit" variant="primary">
                    อนุมัติ
                  </Button>
                </form>
                <form action={returnAction} className="space-y-2">
                  <input type="hidden" name="setId" value={set.id} />
                  <input type="hidden" name="tab" value="exam" />
                  <label className="block">
                    <span className={FIELD_LABEL_CLASS}>ตีกลับให้ผู้สร้าง (เช่น เอกสารหรือ Pricelist ผิด)</span>
                    <textarea name="comment" required rows={2} className={INPUT_CLASS} />
                  </label>
                  <Button type="submit" variant="danger">
                    ตีกลับ
                  </Button>
                </form>
              </div>
            </Card>
          )}
        </div>
      )}

      {tab === "audience" &&
        (org && !org.ok ? (
          <Card>
            <p className="text-[13px] text-danger">ดึงผังจาก WorkID ไม่ได้ — {rules.length ? `เงื่อนไขเดิม: ${rules.map((r) => r.label).join(" · ")}` : "ตั้งผู้รับไม่ได้ตอนนี้"}</p>
          </Card>
        ) : (
          <AudiencePicker
            setId={set.id}
            people={people.map((p) => ({
              personId: p.personId,
              fullName: p.fullName,
              nickname: p.nickname,
              title: p.title,
              teamName: p.teamName,
              positionId: p.positionId,
              teamId: p.teamId,
              managedTeamIds: p.managedTeamIds,
            }))}
            initialRules={rules.map((r) => ({ kind: r.kind, refId: r.refId, label: r.label }))}
            editable={audienceEditable}
            active={set.status === "active"}
            assignedIds={status.map((s) => s.personId)}
          />
        ))}

      {tab === "learners" && (
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

      {tab === "history" && (
        <Card padded={false}>
          {events.length === 0 ? (
            <p className="px-5 py-8 text-center text-[13px] text-muted">ยังไม่มีประวัติ</p>
          ) : (
            <ol className="divide-y divide-line text-[13px]">
              {events.map((e) => (
                <li key={e.id} className="flex flex-wrap gap-x-4 gap-y-1 px-5 py-3">
                  <span className="w-36 shrink-0 text-muted">{formatBangkok(e.createdAt)}</span>
                  <span className="min-w-0 flex-1">
                    <strong className="font-semibold">{e.actorName}</strong> {EVENT_LABELS[e.action] ?? e.action}
                    {eventNote(e.action, e.detail) && <span className="text-ink-2"> {eventNote(e.action, e.detail)}</span>}
                    {e.comment && <span className="text-ink-2"> — {e.comment}</span>}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      )}
    </main>
  );
}

/** ข้อสอบทั้งชุดมาจากไหน — ส่วนที่เปลี่ยน · ชื่อไฟล์ที่ Import */
function eventNote(action: string, detail: unknown): string | null {
  if (action !== "exams_generated" && action !== "exams_imported") return null;
  const d = (detail ?? {}) as { kind?: string; fileName?: string };
  const parts = [d.kind === "delta" && "(ส่วนที่เปลี่ยน)", d.fileName && `จากไฟล์ ${d.fileName}`].filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className="mt-0.5 font-semibold text-fg">{value}</dd>
    </div>
  );
}

type VersionRow = NonNullable<Awaited<ReturnType<typeof getSetDetail>>>["version"];

/** เวอร์ชันใหม่ของชุดที่ใช้อยู่ (spec §7 · ADR-0008) — ผู้สร้างเริ่ม/สรุป/ส่ง · ผู้อนุมัติเลือกอ่านเพื่อรับทราบ/เรียนรู้และทดสอบ แล้วอนุมัติ */
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
  const tab = <input type="hidden" name="tab" value="docs" />;
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
              {tab}
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
                {tab}
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
                {tab}
                <Button type="submit" variant="secondary">
                  ให้ AI สรุปสิ่งที่เปลี่ยน
                </Button>
              </form>
              <form action={submitVersionAction}>
                <input type="hidden" name="setId" value={setId} />
                {tab}
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
                {tab}
                <p className="font-semibold">ผู้เรียนที่ผ่านแล้วต้องทำอะไร</p>
                <label className="flex items-center gap-2">
                  <input type="radio" name="kind" value="small" defaultChecked={newVersion.changeKind === "small"} required />
                  อ่านเพื่อรับทราบ (ราคาบางรุ่น · แก้คำผิด) — อ่านสิ่งที่เปลี่ยนแล้วกดรับทราบ ไม่ต้องสอบ
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="kind" value="large" defaultChecked={newVersion.changeKind === "large"} />
                  เรียนรู้และทดสอบ (Series ใหม่ · เงื่อนไขการขาย) — สอบเฉพาะส่วนที่เปลี่ยน 5 ข้อ
                </label>
                <Button type="submit" size="sm" variant="secondary">
                  บันทึก
                </Button>
              </form>
              {newVersion.changeKind === "large" && (
                <div className="flex flex-wrap items-center gap-2">
                  <form action={generateDeltaAction}>
                    <input type="hidden" name="setId" value={setId} />
                    {tab}
                    <Button type="submit" variant="secondary">
                      {hasDelta ? "ให้ AI ออกข้อสอบส่วนที่เปลี่ยนใหม่" : "ให้ AI ออกข้อสอบส่วนที่เปลี่ยน (5 ชุด × 5 ข้อ)"}
                    </Button>
                  </form>
                  <ExamImport setId={setId} kind="delta" hasExisting={hasDelta} />
                </div>
              )}
              <form action={approveVersionAction}>
                <input type="hidden" name="setId" value={setId} />
                {tab}
                <Button type="submit" variant="primary">
                  อนุมัติเวอร์ชันใหม่
                </Button>
              </form>
              <form action={returnVersionAction} className="space-y-2">
                <input type="hidden" name="setId" value={setId} />
                {tab}
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
