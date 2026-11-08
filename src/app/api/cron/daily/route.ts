import { errorSummary } from "@/lib/errmsg";
import { reportHeartbeat } from "@/lib/gateway";
import { retryApprovalNotices, runReminders, syncAssignments } from "@/lib/assignment-service";
import { deleteExpiredScanImages, deleteRetiredEnrollmentImages } from "@/lib/identity-service";
import { alertTgOfFaceQueue } from "@/lib/tg-alerts";
import { retryNewVersionNotices } from "@/lib/version-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const HB_JOB = "worktrain-daily";
/**
 * รอบเช้าวันละครั้ง (vercel.json `0 2 * * *` = 09:00 เวลาไทย) — มอบให้คนที่เพิ่งตรงเงื่อนไข แล้วเตือนตาม spec §11
 * แล้วลบภาพสแกนที่ครบ 90 วัน (spec §8)
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
    // ข้อความที่ล้มไปแล้วของเหตุการณ์ที่ไม่เกิดซ้ำเอง (อนุมัติ · เวอร์ชันใหม่)
    const retries = {
      approvals: await retryApprovalNotices(),
      versions: await retryNewVersionNotices(),
      // คิวใบหน้าที่ค้าง — แจ้ง TG ที่ยังไม่ได้รับ (ส่งล้มตอนสแกน · TG เพิ่งได้ role) · ที่แจ้งแล้วไม่ซ้ำ
      tgFaces: await alertTgOfFaceQueue(),
    };
    const imagesDeleted = (await deleteExpiredScanImages(now)) + (await deleteRetiredEnrollmentImages());
    const groups = [sync.notified, remind.day3, remind.day5, remind.overdue, retries.approvals, retries.versions, retries.tgFaces];
    const failed = groups.reduce((n, g) => n + g.failed, 0);
    const sent = groups.reduce((n, g) => n + g.sent, 0);
    const healthy = sync.ok && remind.ok && failed === 0;
    await reportHeartbeat(HB_JOB, healthy, {
      ...HB,
      success: sent,
      failed,
      message: `assigned=${sync.assigned} sent=${sent} failed=${failed} imagesDeleted=${imagesDeleted}${sync.why ? ` sync=${sync.why}` : ""}${remind.why ? ` remind=${remind.why}` : ""}`,
    });
    console.log(JSON.stringify({ msg: "cron_daily_done", sync, remind, retries, imagesDeleted }));
    return Response.json({ ok: healthy, sync, remind, retries, imagesDeleted });
  } catch (err) {
    await reportHeartbeat(HB_JOB, false, { ...HB, message: errorSummary(err) });
    console.log(JSON.stringify({ msg: "cron_daily_failed", error: errorSummary(err) }));
    return Response.json({ ok: false, error: errorSummary(err) }, { status: 500 });
  }
}
