import { redirect } from "next/navigation";

/** หน้าเดิม "ชุดที่ปล่อยแล้ว" รวมเข้า `/sets` แล้ว (การ์ด/ตาราง) — เก็บ URL ไว้ให้ลิงก์เก่าและ bookmark ยังใช้ได้ */
export default function ReleasedSetsPage() {
  redirect("/sets");
}
