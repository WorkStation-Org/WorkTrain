import { errorSummary } from "@/lib/errmsg";
import { reportHeartbeat } from "@/lib/gateway";
import { runReminders, syncAssignments } from "@/lib/assignment-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const HB_JOB = "worktrain-daily";
/**
 * รอบเช้าวันละครั้ง (vercel.json `0 2 * * *` = 09:00 เวลาไทย) — มอบให้คนที่เพิ่งตรงเงื่อนไข แล้วเตือนตาม spec §11
 *
 * heartbeat แดงเมื่อถามผังไม่ได้ หรือมีข้อความที่ส่งล้ม (failed) — `skipped` (ไม่ผูก LINE ฯลฯ) ไม่ทำให้แดง
 */
const HB = { intervalMinutes: 24 * 60, graceMinutes: 120 };

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    console.log(JSON.stringify({ msg: secret ? "cron_daily_bad_auth" : "cron_daily_no_secret" }));
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const now = new Date();
    const sync = await syncAssignments({ now });
    const remind = await runReminders({ now });
    const failed = sync.notified.failed + remind.day3.failed + remind.day5.failed + remind.overdue.failed;
    const sent = sync.notified.sent + remind.day3.sent + remind.day5.sent + remind.overdue.sent;
    const healthy = sync.ok && remind.ok && failed === 0;
    await reportHeartbeat(HB_JOB, healthy, {
      ...HB,
      success: sent,
      failed,
      message: `assigned=${sync.assigned} sent=${sent} failed=${failed}${sync.why ? ` sync=${sync.why}` : ""}${remind.why ? ` remind=${remind.why}` : ""}`,
    });
    console.log(JSON.stringify({ msg: "cron_daily_done", sync, remind }));
    return Response.json({ ok: healthy, sync, remind });
  } catch (err) {
    await reportHeartbeat(HB_JOB, false, { ...HB, message: errorSummary(err) });
    console.log(JSON.stringify({ msg: "cron_daily_failed", error: errorSummary(err) }));
    return Response.json({ ok: false, error: errorSummary(err) }, { status: 500 });
  }
}
