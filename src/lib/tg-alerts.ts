import { sendToPerson, type SendResult } from "@/lib/deliver";
import { errorSummary } from "@/lib/errmsg";
import { reviewQueue } from "@/lib/identity-service";
import { fetchOrg, fetchRolePeople } from "@/lib/workid";

/**
 * แจ้ง TG ทาง LINE เมื่อมีงานรอในคิวใบหน้า (spec §11): สแกนไม่ผ่าน 3 ครั้งติด · ขอลงทะเบียนใบหน้าใหม่
 *
 * ★ อ่านจากคิวจริง (`reviewQueue`) ไม่ใช่จากเหตุการณ์ — เรียกซ้ำได้ทุกเมื่อ: หลังสแกนแต่ละครั้ง และใน cron เช้า
 *   (รอบ cron = ส่งซ้ำข้อความที่ล้ม) · dedupe ต่อเรื่องต่อ TG หนึ่งคน จึงไม่แจ้งซ้ำ
 * ★ TG = role `admin` ของแอปที่ WorkID · ไม่แจ้ง TG เรื่องของตัวเอง (ตรวจของตัวเองไม่ได้อยู่แล้ว)
 */

function appUrl(path: string): string {
  return `${process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/+$/, "") ?? ""}${path}`;
}

export async function alertTgOfFaceQueue(): Promise<Record<SendResult, number>> {
  const tally: Record<SendResult, number> = { sent: 0, failed: 0, skipped: 0, duplicate: 0 };
  const q = await reviewQueue();
  if (!q.scanReviews.length && !q.enrollments.length) return tally;
  const tg = await fetchRolePeople("admin");
  if (!tg.ok) {
    console.log(JSON.stringify({ msg: "tg_alert_no_tg_list", why: tg.why }));
    return tally;
  }
  const org = await fetchOrg();
  const people = org.ok ? org.people : null;
  const nameOf = (personId: number) => {
    const p = people?.find((x) => x.personId === personId);
    return p ? (p.nickname ? `${p.name} (${p.nickname})` : p.name) : `personId ${personId}`;
  };
  const link = appUrl("/admin/faces");

  const jobs: { key: string; kind: "tg_scan_review" | "tg_enroll_request"; subject: number; text: string }[] = [
    // คีย์ผูกกับสแกนแรกของชุดที่ไม่ผ่านติดกัน — สแกนไม่ผ่านเพิ่มในชุดเดิมไม่แจ้งซ้ำ
    ...q.scanReviews.map((r) => ({
      key: `tg-scan-review:${r.personId}:${r.scans.at(-1)!.id}`,
      kind: "tg_scan_review" as const,
      subject: r.personId,
      text: `🔍 ${nameOf(r.personId)} สแกนใบหน้าไม่ผ่าน ${r.scans.length} ครั้งติด — รอ TG ตรวจภาพ\n${link}`,
    })),
    ...q.enrollments.map((e) => ({
      key: `tg-enroll:${e.id}`,
      kind: "tg_enroll_request" as const,
      subject: e.personId,
      text: `🪪 ${nameOf(e.personId)} ขอลงทะเบียนใบหน้าใหม่ — รอ TG อนุมัติ\n${link}`,
    })),
  ];
  for (const j of jobs) {
    for (const tgId of tg.personIds) {
      if (tgId === j.subject) continue;
      const out = await sendToPerson({ dedupeKey: `${j.key}:${tgId}`, kind: j.kind, personId: tgId, text: j.text }, people);
      tally[out] += 1;
    }
  }
  return tally;
}

/** เรียกหลังสแกน — แจ้งไม่ได้ไม่ทำให้การสแกนล้ม (cron เช้าส่งซ้ำให้) */
export async function alertTgQuietly(): Promise<void> {
  try {
    await alertTgOfFaceQueue();
  } catch (err) {
    console.log(JSON.stringify({ msg: "tg_alert_failed", error: errorSummary(err) }));
  }
}
