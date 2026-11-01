/**
 * ออก key ให้ระบบอื่นที่อ่าน `/api/v1/*` ของ WorkTrain (spec §6) — รันบนเครื่อง: `npm run api:new-key -- workhr`
 *
 * พิมพ์สองอย่าง:
 *   1. key เต็ม (`wtr_…`) — ส่งให้ระบบปลายทางทางช่องลับ **ครั้งเดียว** · WorkTrain ไม่เก็บ key เต็มที่ไหนเลย
 *   2. บรรทัด `ชื่อ:read:<sha256>` — ต่อท้าย `WORKTRAIN_API_CONSUMERS` บน Vercel (คั่นจุลภาค) แล้ว redeploy
 * หมุน key = ออกใหม่ด้วยชื่อเดิม แทนบรรทัดเดิมใน env · ถอน = ลบบรรทัดออก
 * ไม่แตะฐาน ไม่อ่าน env
 */
import { consumerEntry, newConsumerKey } from "@/lib/api-consumers";

const name = process.argv[2]?.trim() ?? "";
if (!/^[a-z][a-z0-9-]{1,39}$/.test(name)) {
  console.error("ใช้: npm run api:new-key -- <ชื่อ consumer ตัวเล็ก เช่น workhr>");
  process.exit(1);
}
const key = newConsumerKey();
console.log(`key ของ ${name} (ส่งให้ระบบปลายทางครั้งเดียว — ไม่เก็บที่ WorkTrain):\n  ${key}\n`);
console.log(`ต่อท้าย WORKTRAIN_API_CONSUMERS บน Vercel (คั่นจุลภาค) แล้ว redeploy:\n  ${consumerEntry(name, ["read"], key)}`);
