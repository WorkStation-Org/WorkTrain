import { and, eq, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import { errorSummary } from "@/lib/errmsg";
import { getFriendship, pushAsync, pushMany } from "@/lib/gateway";
import { LINE_GROUP_ID } from "@/lib/line-group";
import { getWorkIdPerson, type OrgPerson } from "@/lib/workid";

/**
 * ส่ง LINE ตัวต่อตัว (`sendToPerson`) หรือเข้ากลุ่มประจำตัว (`sendToGroup`) พร้อมบันทึกผลทุกครั้ง
 * — ยกมาจาก WorkDaily `src/lib/deliver.ts` (ซึ่งยกจาก WorkDecision) ตัดส่วนรายงาน/Flex ที่ WorkTrain ไม่ใช้
 *
 * ★ ข้อ 12: ไม่มี `jobId` จาก GateWay = ไม่นับว่าส่งแล้ว · retry ครั้งเดียวอยู่ใน `pushAsync()`
 * ★ จองแถวด้วย `dedupe_key` ก่อนส่ง — สองรอบที่ชนกันส่งได้ครั้งเดียว · แถวที่ล้มจองใหม่ได้ (รอบ cron ถัดไปลองซ้ำ)
 */

export type SendResult = "sent" | "failed" | "skipped" | "duplicate";

export const MAX_SEND_ATTEMPTS = 5;
export const STALE_PENDING_MS = 5 * 60 * 1000;

/**
 * ช่วง dev ทุกข้อความไปกลุ่ม Test — ตั้ง `TEST_LINE_GROUP_ID` แล้วไม่มีพนักงานคนไหนได้ข้อความจริง
 * ★ ตัวสลับเดียวของการเปิดใช้: ลบ env นี้ออกจาก Production = เริ่มส่งจริง · ค่าผิดรูปแบบต้องดัง ไม่ใช่ส่งจริงเงียบ ๆ
 */
export function testGroupOverride(): string | null {
  const raw = process.env.TEST_LINE_GROUP_ID?.trim();
  if (!raw) return null;
  if (!LINE_GROUP_ID.test(raw)) throw new Error("TEST_LINE_GROUP_ID รูปแบบไม่ถูกต้อง (ต้องเป็น C + hex 32 ตัว)");
  return raw;
}

/** ชนิดของข้อความใน `notifications.kind` — ใช้เป็น `notificationType` ของ GateWay ด้วย (spec §11) */
export type NotificationKind =
  | "approval_requested"
  | "approval_returned"
  | "approval_approved"
  | "assigned"
  | "remind_day3"
  | "remind_day5"
  | "overdue_summary";

interface Target {
  dedupeKey: string;
  kind: NotificationKind;
  personId: number | null;
  setId?: number | null;
  assignmentId?: number | null;
  text: string;
}

function toLineMessages(text: string): unknown[] {
  return [{ type: "text", text: text.slice(0, 4900) }];
}

type Finish = (status: "sent" | "failed" | "skipped", jobIds: string[], detail: string | null) => Promise<SendResult>;

/**
 * จองแถว — ใหม่ = จองได้ · `failed` หรือ `pending` ที่ค้างเกินกำหนด = จองใหม่ได้ (ลองส่งซ้ำ)
 * · `sent`/`skipped` หรือ `pending` ที่ยังสด = มีคนทำไปแล้ว → null (ไม่ส่งซ้ำ)
 */
async function claim(row: Target & { lineGroupId: string | null }): Promise<Finish | null> {
  const staleBefore = new Date(Date.now() - STALE_PENDING_MS);
  const claimed = await db()
    .insert(notifications)
    .values({
      dedupeKey: row.dedupeKey,
      kind: row.kind,
      personId: row.personId,
      setId: row.setId ?? null,
      assignmentId: row.assignmentId ?? null,
      lineGroupId: row.lineGroupId,
      text: row.text,
      status: "pending",
    })
    .onConflictDoUpdate({
      target: notifications.dedupeKey,
      set: { status: "pending", attempts: sql`${notifications.attempts} + 1`, claimedAt: sql`now()`, lineGroupId: row.lineGroupId },
      setWhere: and(
        lt(notifications.attempts, MAX_SEND_ATTEMPTS),
        or(eq(notifications.status, "failed"), and(eq(notifications.status, "pending"), lt(notifications.claimedAt, staleBefore))),
      ),
    })
    .returning({ id: notifications.id });
  if (claimed.length === 0) return null;
  const rowId = claimed[0].id;
  return async (status, jobIds, detail) => {
    await db()
      .update(notifications)
      .set({ status, jobIds, detail })
      .where(and(eq(notifications.id, rowId), eq(notifications.status, "pending")));
    return status;
  };
}

/** เหตุที่ส่งตัวต่อตัวไม่ได้ — บันทึกใน `notifications.detail` ให้ TG เห็นว่าใครตั้งค่าไม่ครบ */
export const PERSON_SKIP = {
  notInOrg: "ไม่พบคนนี้ในผังองค์กรของ WorkID",
  inactive: "พ้นสภาพหรือไม่มีในทะเบียน WorkID",
  noLine: "ยังไม่ได้ผูก LINE กับ WorkID (พิมพ์ #me ใน Work Bot)",
  notFriend: "ยังไม่ได้แอด Work Bot เป็นเพื่อน (หรือบล็อกไว้)",
} as const;

/**
 * ส่งเข้ากลุ่ม LINE ประจำตัว (เจ้าตัว + หัวหน้า) — เตือนวันที่ 5 (spec §11)
 * ไม่มีกลุ่ม = `skipped` พร้อมเหตุผล · ผู้เรียกตัดสินเองว่าจะส่งตัวต่อตัวแทนไหม
 */
export async function sendToGroup(m: Target & { lineGroupId: string | null }): Promise<SendResult> {
  const target = testGroupOverride() ?? m.lineGroupId;
  const finish = await claim({ ...m, lineGroupId: target });
  if (!finish) return "duplicate";
  if (!target) return finish("skipped", [], "ยังไม่ได้ตั้งกลุ่ม LINE ประจำตัวใน WorkID");
  try {
    const outcome = await pushAsync({
      to: target,
      messages: toLineMessages(m.text),
      idempotencyKey: `wtr:${m.dedupeKey}:${target}`,
      notificationType: `worktrain.${m.kind}`,
    });
    if (!outcome.ok) return finish("failed", [], outcome.error.slice(0, 500));
    return finish("sent", [outcome.jobId], null);
  } catch (err) {
    return finish("failed", [], errorSummary(err));
  }
}

/**
 * ส่งตัวต่อตัวผ่าน Work Bot — personId → อีเมลจากผัง → `GET /v1/people/{email}` ได้ LINE ทุกเครื่อง →
 * ตัดเครื่องที่ไม่ได้แอด Work Bot → `push-async` ทุกเครื่องที่เหลือพร้อมกัน (ข้อ 12 ข้อ 3)
 *
 * ★ ส่งไม่ได้เพราะการตั้งค่า = `skipped` พร้อมเหตุผล ไม่ใช่ `failed` (ไม่ต้องลองซ้ำ)
 * ★ `TEST_LINE_GROUP_ID` ตั้งอยู่ = ข้อความตัวต่อตัวก็ไปกลุ่ม Test พร้อมบอกว่าจะถึงใคร
 */
export async function sendToPerson(m: Target & { personId: number }, people: readonly OrgPerson[]): Promise<SendResult> {
  const testGroup = testGroupOverride();
  const finish = await claim({ ...m, lineGroupId: testGroup });
  if (!finish) return "duplicate";

  const person = people.find((p) => p.personId === m.personId);
  try {
    if (testGroup) {
      const to = person?.name ?? `personId ${m.personId}`;
      const outcome = await pushAsync({
        to: testGroup,
        messages: [{ type: "text", text: `[ทดสอบ · ข้อความตัวต่อตัวถึง ${to}]` }, ...toLineMessages(m.text)],
        idempotencyKey: `wtr:${m.dedupeKey}:${testGroup}`,
        notificationType: `worktrain.${m.kind}`,
      });
      if (!outcome.ok) return finish("failed", [], outcome.error.slice(0, 500));
      return finish("sent", [outcome.jobId], "ส่งเข้ากลุ่ม Test (TEST_LINE_GROUP_ID)");
    }

    if (!person) return finish("skipped", [], PERSON_SKIP.notInOrg);
    const lookup = await getWorkIdPerson(person.email);
    if (lookup.found === "unknown") return finish("failed", [], `WorkID ตอบไม่ได้ (${lookup.why})`);
    if (!lookup.found || !lookup.active) return finish("skipped", [], PERSON_SKIP.inactive);
    if (lookup.lineUserIds.length === 0) return finish("skipped", [], PERSON_SKIP.noLine);

    const friendships = await Promise.all(lookup.lineUserIds.map((id) => getFriendship(id)));
    // ตอบไม่ได้ = ส่งไปก่อน (fail-open) · รู้แน่ว่าไม่ใช่เพื่อนเท่านั้นที่ตัดออก
    const targets = lookup.lineUserIds.filter((_, i) => friendships[i].status !== "not_friend");
    if (targets.length === 0) return finish("skipped", [], PERSON_SKIP.notFriend);

    const messages = toLineMessages(m.text);
    const outcomes = await pushMany(
      targets.map((to) => ({ to, messages, idempotencyKey: `wtr:${m.dedupeKey}:${to}`, notificationType: `worktrain.${m.kind}` })),
    );
    const jobIds = outcomes.flatMap((o) => (o.ok ? [o.jobId] : []));
    const errors = outcomes.flatMap((o) => (o.ok ? [] : [o.error]));
    if (jobIds.length === 0) return finish("failed", [], errors.join(" · ").slice(0, 500) || "ไม่มี jobId");
    return finish("sent", jobIds, errors.length > 0 ? `บางเครื่องไม่ผ่าน: ${errors.join(" · ")}`.slice(0, 500) : null);
  } catch (err) {
    return finish("failed", [], errorSummary(err));
  }
}
