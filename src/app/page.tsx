import Link from "next/link";
import { Card } from "@/components/ui";
import { firstParam, pageActor } from "@/lib/page";
import { callName } from "@/lib/person-name";

export const dynamic = "force-dynamic";

const ROLE_LABELS = { admin: "TG (ดูแลระบบ)", author: "ผู้สร้าง", user: "ผู้เรียน" } as const;

/**
 * หน้าแรก — รุ่นที่ 1 ยังอยู่ระหว่างสร้าง (ADR-0001) · หน้านี้มีไว้ยืนยันว่าล็อกอินผ่าน WorkID ได้จริง
 * หน้าจอของผู้เรียน / ผู้สร้าง / TG ตามมาใน slice ถัดไป
 */
export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await pageActor();
  const err = firstParam((await searchParams).err);
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-4">
      {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-700">{err}</p>}
      <Card>
        <h1 className="text-xl font-bold tracking-tight text-ink">สวัสดี {callName(actor)}</h1>
        <p className="mt-1 text-[13px] text-ink-3">
          {actor.email} · {ROLE_LABELS[actor.role]}
        </p>
        <p className="mt-4 text-[13px] text-ink-2">WorkTrain รุ่นใหม่กำลังสร้าง — ยังไม่เปิดใช้จริง</p>
        <Link href="/learn" className="mt-3 block text-[13px] font-semibold text-ink underline">
          ชุดที่ต้องเรียน
        </Link>
        <Link href="/dashboard" className="mt-2 block text-[13px] font-semibold text-ink underline">
          Dashboard + Leaderboard
        </Link>
        <Link href="/enroll" className="mt-2 block text-[13px] font-semibold text-ink underline">
          ลงทะเบียนใบหน้า
        </Link>
        {actor.role === "admin" && (
          <Link href="/admin/faces" className="mt-2 block text-[13px] font-semibold text-ink underline">
            ตรวจภาพใบหน้า (TG)
          </Link>
        )}
        {actor.role === "admin" && (
          <Link href="/admin/onboarding" className="mt-2 block text-[13px] font-semibold text-ink underline">
            เส้นทาง Onboarding (TG)
          </Link>
        )}
        <Link href="/sets" className="mt-2 inline-block text-[13px] font-semibold text-ink underline">
          ชุดการเรียนรู้ (สร้าง · ออกข้อสอบ · อนุมัติ)
        </Link>
        <form action="/api/auth/logout" method="post" className="mt-4">
          <button type="submit" className="text-[13px] font-medium text-ink-2 underline">
            ออกจากระบบ
          </button>
        </form>
      </Card>
    </main>
  );
}
