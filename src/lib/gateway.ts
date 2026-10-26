import { errorSummary } from "@/lib/errmsg";
import { LINE_GROUP_ID } from "@/lib/line-group";

/**
 * ส่ง LINE ทุกดอกผ่าน GateWay — **ไม่มีการเรียก `api.line.me` ตรงจากที่นี่** (ข้อ 5)
 *
 * ★ ไฟล์นี้คือที่ที่บั๊กของ PDList อยู่ (9 ส.ค. 2026) กติกาข้อ 12 เขียนขึ้นจากมันตรง ๆ:
 *   PDList ยิงเข้ากลุ่มก่อน 1:1 เสมอ กลุ่มจึงรับ cold start ทุกครั้ง แล้ว `catch`
 *   คืน `false` เงียบ ๆ ส่วนฟังก์ชันคืน `{ok:true, sent:0}` = "สำเร็จ" ทั้งที่ไม่มี
 *   ใครได้รับ → **แจ้งเตือนกลุ่มหายทั้งวันจนผู้ใช้มาทักเอง**
 *
 * สามข้อที่ต้องทำครบ:
 *   1. retry อย่างน้อย 1 ครั้งเมื่อ **ต่อไม่ติด/timeout** · **ห้าม retry เมื่อได้ status
 *      กลับมา** (ปลายทางรับไปแล้ว และ GateWay retry ต่อเองอีก 6 ครั้ง)
 *   2. **ห้ามรายงานว่าสำเร็จเมื่อไม่ถึงใคร** — 2xx ที่ไม่มี `jobId` ไม่นับว่าสำเร็จ
 *      เพราะ `jobId` เป็นเส้นเดียวที่ลากต่อไปหา `/api/outbound-jobs` ได้
 *   3. **ยิงพร้อมกันเสมอ** (`pushMany`) ไม่ให้ช่องทางใดเป็นตัวรับ cold start ประจำ
 */

/**
 * เผื่อ cold start — ทุกอย่างในเครือรันบน Worker/Vercel/Neon ที่หลับได้
 * และ **คำขอแรกของทุกชุดคือตัวที่ตาย** · `push-async` แค่ enqueue จึงเร็วเมื่อตื่นแล้ว
 * เวลาส่วนใหญ่ของคำขอแรกคือการปลุกทั้งเส้น
 */
export const PUSH_TIMEOUT_MS = 10_000;

const baseUrl = () => process.env.GATEWAY_BASE_URL?.replace(/\/+$/, "") ?? "";
const apiKey = () => process.env.GATEWAY_API_KEY ?? "";
const channelId = () => process.env.GATEWAY_LINE_CHANNEL_ID ?? "";

export function gatewayConfigured(): boolean {
  return Boolean(baseUrl() && apiKey() && channelId());
}

export interface PushRequest {
  /** `U…` (คน) หรือ `C…` (กลุ่ม) — GateWay บังคับ `^[UCR][0-9a-f]{32}$` */
  to: string;
  /** LINE message objects ไม่เกิน 5 ตัว */
  messages: unknown[];
  /**
   * `ticket:<id>:<event>:<reopen_count>` (+ ปลายทาง)
   *
   * `reopen_count` จำเป็น — ไม่มีมันการแจ้ง resolve รอบสองจะถูก GateWay มองเป็น
   * duplicate แล้ว **เงียบหาย** (ดู docs/PLAN.md §Notification)
   */
  idempotencyKey: string;
  notificationType?: string;
}

export type PushOutcome =
  | { ok: true; status: "queued" | "duplicate"; jobId: string }
  | { ok: false; error: string; retried: boolean };

/** ต่อไม่ติด/timeout = ยังไม่รู้ว่าถึงปลายทางไหม → retry ได้ · ต่างจาก "ได้ status กลับมา" */
function isConnectFailure(err: unknown): boolean {
  return err instanceof Error;
}

async function postOnce(req: PushRequest): Promise<Response> {
  return fetch(`${baseUrl()}/v1/line/${channelId()}/push-async`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey()}`, "content-type": "application/json" },
    body: JSON.stringify({
      to: req.to,
      messages: req.messages,
      idempotencyKey: req.idempotencyKey,
      ...(req.notificationType ? { notificationType: req.notificationType } : {}),
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
  });
}

/**
 * ยิงหนึ่งปลายทาง — ใช้ `push-async` เสมอ **ไม่ใช้ `/push`**
 * (`/push` ไม่มี retry ไม่มี idempotency ส่งพลาดคือหาย)
 */
export async function pushAsync(req: PushRequest): Promise<PushOutcome> {
  if (!gatewayConfigured()) {
    return { ok: false, error: "gateway_not_configured", retried: false };
  }

  let res: Response;
  let retried = false;
  try {
    res = await postOnce(req);
  } catch (first) {
    if (!isConnectFailure(first)) throw first;
    // ★ ข้อ 12 ข้อ 1 — คำขอแรกของชุดคือตัวที่ตาย ลองอีกครั้งด้วย key เดิม
    //   (key เดิมสำคัญ: ถ้าครั้งแรกถึงจริงแล้ว GateWay จะตอบ duplicate ไม่ส่งซ้ำ)
    retried = true;
    console.log(
      JSON.stringify({ msg: "gateway_push_retry", to: req.to, error: errorSummary(first) }),
    );
    try {
      res = await postOnce(req);
    } catch (second) {
      console.log(
        JSON.stringify({ msg: "gateway_push_failed", to: req.to, error: errorSummary(second) }),
      );
      return { ok: false, error: errorSummary(second), retried: true };
    }
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }

  if (!res.ok && res.status !== 202) {
    // ได้ status กลับมา = ปลายทางรับคำขอไปแล้วและตัดสินใจแล้ว → **ไม่ retry**
    const detail =
      typeof body === "object" && body !== null && typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : `http_${res.status}`;
    console.log(
      JSON.stringify({ msg: "gateway_push_rejected", to: req.to, status: res.status, detail }),
    );
    return { ok: false, error: detail, retried };
  }

  const v = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const jobId = typeof v.jobId === "string" && v.jobId ? v.jobId : null;
  const status = v.status === "duplicate" ? "duplicate" : "queued";

  if (!jobId) {
    // ★ ข้อ 12 ข้อ 2: 2xx ที่ไม่มี jobId ตอบคำถาม "ใบนี้ส่งไปหรือยัง" ไม่ได้
    //   ซึ่งเท่ากับไม่รู้ว่าถึงใครหรือไม่ → ไม่นับว่าสำเร็จ
    console.log(
      JSON.stringify({ msg: "gateway_push_no_job_id", to: req.to, status: res.status, keys: Object.keys(v) }),
    );
    return { ok: false, error: "gateway ตอบสำเร็จแต่ไม่มี jobId", retried };
  }

  return { ok: true, status, jobId };
}

/**
 * ยิงหลายปลายทาง **พร้อมกัน** — `Promise.allSettled` ไม่ใช่ `for … await`
 *
 * ★ ข้อ 12 ข้อ 3: ห้ามให้ช่องทางใดเป็นตัวรับ cold start ให้ช่องทางอื่นประจำ
 *   ยิงเรียงกันแปลว่าปลายทางแรกจ่ายค่าปลุกระบบให้ปลายทางหลังทุกครั้ง
 *
 * ผลลัพธ์เรียง **ตามลำดับที่ส่งเข้ามา** ไม่ใช่ลำดับที่เสร็จ — ผู้เรียกต้องรู้ว่า
 * ผลไหนของปลายทางไหน เพื่อบันทึกลง `ticket_notifications` ให้ถูกแถว
 */
export async function pushMany(requests: PushRequest[]): Promise<PushOutcome[]> {
  const settled = await Promise.allSettled(requests.map((r) => pushAsync(r)));
  return settled.map((s, i) =>
    s.status === "fulfilled"
      ? s.value
      : {
          ok: false as const,
          // pushAsync ไม่ควร reject เลย — ถ้ามาถึงตรงนี้คือมีของที่ไม่ได้เผื่อไว้
          // และมันต้องไม่กลายเป็น "สำเร็จ" หรือหายเงียบ
          error: `pushAsync โยน exception ที่ไม่ได้เผื่อไว้: ${errorSummary(s.reason)}`,
          retried: false,
        },
  );
}

/** ผลถามชื่อกลุ่ม — `not_found` = Work Bot ไม่ได้อยู่ในกลุ่มนี้ (แล้ว) · `unavailable` = ยังไม่รู้คำตอบ */
export type GroupSummary =
  | { status: "ok"; name: string | null }
  | { status: "not_found" }
  | { status: "unavailable"; why: string };

/** หน้าจอ admin รอคำตอบนี้ตอน render — สั้นกว่า push เพราะไม่มีใครรอนานหน้าจอ */
export const SUMMARY_TIMEOUT_MS = 6_000;

/**
 * ถามชื่อกลุ่มและเช็กว่า Work Bot ยังอยู่ในกลุ่ม — `GET /v1/line/:channelId/groups/:groupId/summary` ของ GateWay
 * (อ่านอย่างเดียว ไม่ผ่านรายการผู้รับที่อนุญาต) ใช้คีย์ชุดเดียวกับตอนส่ง
 *
 * ★ สัญญาเดียวกับ `/profile`: เรียกสำเร็จ = 200 แล้วดู `status` ("ok" | "not_found") · ตอบไม่ได้ = 4xx/5xx
 *   ผู้เรียกจึงแยก "รู้แล้วว่าไม่อยู่ในกลุ่ม" ออกจาก "ยังไม่รู้" ได้ — สองอย่างนี้ต้องไม่ปนกัน
 * ★ ข้อ 12: ต่อไม่ติด/timeout retry หนึ่งครั้ง (อ่านซ้ำได้ปลอดภัย) · ได้ status กลับมาไม่ retry · **ไม่กลืน error**
 *   — ตอบไม่ได้คืน `unavailable` พร้อมเหตุผล ไม่ใช่ทำเหมือนกลุ่มปกติ
 */
export async function getGroupSummary(groupId: string): Promise<GroupSummary> {
  if (!gatewayConfigured()) return { status: "unavailable", why: "gateway_not_configured" };
  if (!LINE_GROUP_ID.test(groupId)) return { status: "unavailable", why: "bad_group_id" };

  const get = () =>
    fetch(`${baseUrl()}/v1/line/${channelId()}/groups/${groupId}/summary`, {
      headers: { authorization: `Bearer ${apiKey()}` },
      cache: "no-store",
      signal: AbortSignal.timeout(SUMMARY_TIMEOUT_MS),
    });

  let res: Response;
  try {
    res = await get();
  } catch (first) {
    console.log(JSON.stringify({ msg: "gateway_group_summary_retry", error: errorSummary(first) }));
    try {
      res = await get();
    } catch (second) {
      console.log(JSON.stringify({ msg: "gateway_group_summary_failed", error: errorSummary(second) }));
      return { status: "unavailable", why: errorSummary(second) };
    }
  }

  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = await res.json();
    if (typeof parsed === "object" && parsed !== null) body = parsed as Record<string, unknown>;
  } catch {
    // ไม่ใช่ JSON — ใช้ status แทน
  }

  if (res.ok && body.status === "ok") {
    const group = typeof body.group === "object" && body.group !== null ? (body.group as Record<string, unknown>) : {};
    return { status: "ok", name: typeof group.name === "string" && group.name ? group.name : null };
  }
  if (res.ok && body.status === "not_found") return { status: "not_found" };

  const why = typeof body.error === "string" && body.error ? body.error : `http_${res.status}`;
  console.log(JSON.stringify({ msg: "gateway_group_summary_rejected", status: res.status, why }));
  return { status: "unavailable", why };
}

/** ผลถามว่า LINE เครื่องนี้แอด Work Bot เป็นเพื่อนอยู่ไหม — `unavailable` = ยังไม่รู้คำตอบ */
export type Friendship = { status: "friend" } | { status: "not_friend" } | { status: "unavailable"; why: string };

const LINE_USER_ID = /^U[0-9a-f]{32}$/;

/**
 * `GET /v1/line/:channelId/profile/:userId` ของ GateWay — สัญญาเดียวกับ `getGroupSummary()`:
 * 200 + `status: "ok"` = เป็นเพื่อน · 200 + `status: "not_friend"` = ยังไม่แอด/บล็อก (push ไม่ถึงแน่) · อื่น ๆ = ยังไม่รู้
 *
 * ★ ใช้ก่อนส่งเตือนตัวต่อตัว: `push-async` ตอบ 202 ก่อนถึง LINE — ส่งหาคนที่ไม่ได้แอด Work Bot จะได้ jobId
 *   แล้วไปตายในคิวของ GateWay ทีหลัง ฝั่งเราจะบันทึกว่า "ส่งแล้ว" ทั้งที่ไม่ถึงใคร (ข้อ 12)
 * ★ ตอบไม่ได้ = `unavailable` ไม่ใช่ `not_friend` — ผู้เรียกต้องส่งต่อไป (fail-open) ไม่ใช่ตัดคนนั้นทิ้ง
 */
export async function getFriendship(userId: string): Promise<Friendship> {
  if (!gatewayConfigured()) return { status: "unavailable", why: "gateway_not_configured" };
  if (!LINE_USER_ID.test(userId)) return { status: "unavailable", why: "bad_user_id" };

  const get = () =>
    fetch(`${baseUrl()}/v1/line/${channelId()}/profile/${userId}`, {
      headers: { authorization: `Bearer ${apiKey()}` },
      cache: "no-store",
      signal: AbortSignal.timeout(SUMMARY_TIMEOUT_MS),
    });

  let res: Response;
  try {
    res = await get();
  } catch (first) {
    console.log(JSON.stringify({ msg: "gateway_profile_retry", error: errorSummary(first) }));
    try {
      res = await get();
    } catch (second) {
      return { status: "unavailable", why: errorSummary(second) };
    }
  }

  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = await res.json();
    if (typeof parsed === "object" && parsed !== null) body = parsed as Record<string, unknown>;
  } catch {
    // ไม่ใช่ JSON — ใช้ status แทน
  }
  if (res.ok && body.status === "ok") return { status: "friend" };
  if (res.ok && body.status === "not_friend") return { status: "not_friend" };
  const why = typeof body.error === "string" && body.error ? body.error : `http_${res.status}`;
  console.log(JSON.stringify({ msg: "gateway_profile_rejected", status: res.status, why }));
  return { status: "unavailable", why };
}

/** ผลของงาน push-async หนึ่งงานตามที่ GateWay เห็น — `status` คือสถานะของ `outbound_jobs` */
export interface PushJobStatus {
  jobId: string;
  status: string;
  lastStatusCode: number | null;
  lastError: string | null;
}

/** ถามได้ครั้งละไม่เกินเท่านี้ (สัญญาของ GateWay) */
export const JOB_STATUS_BATCH = 100;

export type JobStatusOutcome = { ok: true; jobs: PushJobStatus[]; missing: string[] } | { ok: false; why: string };

/**
 * `GET /v1/line/:channelId/push-async/status?ids=…` ของ GateWay (PR GateWay#125) — LINE รับงานที่ฝากไว้จริงไหม
 *
 * ★ `push-async` ตอบ jobId ก่อนถึง LINE · ไม่ถามที่นี่ = ไม่รู้เลยว่า LINE ปฏิเสธทีหลัง (เคส 21–22 ต.ค. 2569
 *   รายงาน 2 ใบขึ้นว่าส่งเข้ากลุ่มแล้วทั้งที่ Work Bot ไม่อยู่ในกลุ่ม) · ผู้เรียกคือ `checkDeliveries()`
 * ★ เห็นเฉพาะ job ของ key เรา · ไม่เจอ (ของคนอื่น/ถูกลบหลัง 30 วัน) อยู่ใน `missing`
 * ★ ตอบไม่ได้ = `ok: false` · ผู้เรียกปล่อยไว้ถามรอบหน้า ไม่ตัดสินอะไร
 */
export async function pushJobStatuses(jobIds: string[]): Promise<JobStatusOutcome> {
  if (!gatewayConfigured()) return { ok: false, why: "gateway_not_configured" };
  if (jobIds.length === 0) return { ok: true, jobs: [], missing: [] };
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}/v1/line/${channelId()}/push-async/status?ids=${jobIds.slice(0, JOB_STATUS_BATCH).join(",")}`, {
      headers: { authorization: `Bearer ${apiKey()}` },
      cache: "no-store",
      signal: AbortSignal.timeout(SUMMARY_TIMEOUT_MS),
    });
  } catch (err) {
    return { ok: false, why: errorSummary(err) };
  }
  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = await res.json();
    if (typeof parsed === "object" && parsed !== null) body = parsed as Record<string, unknown>;
  } catch {
    // ไม่ใช่ JSON — เช่น GateWay รุ่นที่ยังไม่มี endpoint นี้
  }
  if (!res.ok || !Array.isArray(body.jobs) || !Array.isArray(body.missing)) {
    return { ok: false, why: typeof body.error === "string" && body.error ? body.error : `http_${res.status}` };
  }
  const jobs = body.jobs.flatMap((j): PushJobStatus[] => {
    if (!j || typeof j !== "object") return [];
    const r = j as Record<string, unknown>;
    if (typeof r.jobId !== "string" || typeof r.status !== "string") return [];
    return [
      {
        jobId: r.jobId,
        status: r.status,
        lastStatusCode: typeof r.lastStatusCode === "number" ? r.lastStatusCode : null,
        lastError: typeof r.lastError === "string" ? r.lastError : null,
      },
    ];
  });
  return { ok: true, jobs, missing: body.missing.filter((m): m is string => typeof m === "string") };
}

export interface ReplyRequest {
  /** `replyToken` จาก event ที่ GateWay ส่งต่อมา — ใช้ได้ครั้งเดียว อายุ ~1 นาที */
  replyToken: string;
  /** LINE message objects ไม่เกิน 5 ตัว */
  messages: unknown[];
}

export type ReplyOutcome =
  | { ok: true }
  /** `invalid_reply_token` = token หมดอายุ/ถูกใช้แล้ว → ผู้เรียกควรถอยไป `pushAsync` */
  | { ok: false; reason: string };

/**
 * ตอบด้วย reply token ผ่าน `/v1/line/:channelId/reply` — **ไม่กินโควตา push** ของ OA
 *
 * ใช้กับ auto-reply เท่านั้น (ข้อความที่หายไปได้โดยไม่มีผลกับเคส) · แจ้งเตือนของเคส
 * ยังต้องเป็น `pushAsync` เพราะมี `jobId` ให้ตามรอยและ GateWay retry ให้
 *
 * **ไม่ retry แม้ต่อไม่ติด** ต่างจาก `pushAsync` — token ใช้ได้ครั้งเดียว ถ้าครั้งแรก
 * ถึง LINE แล้วแต่เราไม่ได้คำตอบ ครั้งที่สองจะได้ invalid token เปล่า ๆ และไม่มี
 * idempotency ให้พึ่ง · ผู้เรียกตัดสินเองว่าจะถอยไป push ไหม
 */
export async function replyOnce(req: ReplyRequest): Promise<ReplyOutcome> {
  if (!gatewayConfigured()) return { ok: false, reason: "gateway_not_configured" };

  let res: Response;
  try {
    res = await fetch(`${baseUrl()}/v1/line/${channelId()}/reply`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey()}`, "content-type": "application/json" },
      body: JSON.stringify({ replyToken: req.replyToken, messages: req.messages }),
      cache: "no-store",
      signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
    });
  } catch (err) {
    const reason = errorSummary(err);
    console.log(JSON.stringify({ msg: "gateway_reply_failed", error: reason }));
    return { ok: false, reason };
  }

  if (res.ok) return { ok: true };

  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = await res.json();
    if (typeof parsed === "object" && parsed !== null) body = parsed as Record<string, unknown>;
  } catch {
    // ไม่ใช่ JSON — ใช้ status แทน
  }
  const reason =
    body.status === "invalid_reply_token"
      ? "invalid_reply_token"
      : typeof body.error === "string" && body.error
        ? body.error
        : `http_${res.status}`;
  console.log(JSON.stringify({ msg: "gateway_reply_rejected", status: res.status, reason }));
  return { ok: false, reason };
}

/**
 * รายงานผลจบรอบ cron เข้า WorkMonitor v0 (`POST /hb/report` ของ GateWay) — ยกมาจาก WorkService
 *
 * ★ ชื่อฟิลด์/หน่วยตรวจกับโค้ด GateWay แล้ว (`src/hbreport.ts`): `intervalMinutes`/`graceMinutes`
 *   เป็นนาที · `status` รับแค่ `"ok"`/`"fail"` · body ผิดรูปได้ 400 แล้ว job **ไม่ถูกเฝ้าเลย**
 *   (เคส WorkDoc `monthly-backup` 12 ส.ค.)
 *
 * heartbeat ส่งแบบไม่รอผลได้ แต่ความล้มเหลวต้องมีร่องรอยใน log เสมอ
 */
export async function reportHeartbeat(
  job: string,
  ok: boolean,
  opts: { intervalMinutes: number; graceMinutes: number; success?: number; failed?: number; message?: string },
): Promise<void> {
  if (!baseUrl() || !apiKey()) {
    console.log(JSON.stringify({ msg: "hb_report_skipped", job, ok, why: "gateway_not_configured" }));
    return;
  }
  try {
    const res = await fetch(`${baseUrl()}/hb/report`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey()}`, "content-type": "application/json" },
      body: JSON.stringify({
        job,
        status: ok ? "ok" : "fail",
        intervalMinutes: opts.intervalMinutes,
        graceMinutes: opts.graceMinutes,
        ...(opts.success === undefined ? {} : { success: opts.success }),
        ...(opts.failed === undefined ? {} : { failed: opts.failed }),
        ...(opts.message ? { message: opts.message.slice(0, 1000) } : {}),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      const why = await res.text().catch(() => "");
      console.log(JSON.stringify({ msg: "hb_report_rejected", job, status: res.status, why: why.slice(0, 300) }));
    }
  } catch (err) {
    console.log(JSON.stringify({ msg: "hb_report_unreachable", job, error: errorSummary(err) }));
  }
}
