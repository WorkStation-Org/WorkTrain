import Link from "next/link";
import { Alert, Badge, Button, Card, EmptyState, Icon, PageHeader, SectionLabel, Stat, type IconName } from "@/components/ui";
import { enrollmentState, hasConsent } from "@/lib/identity-service";
import { myAssignments } from "@/lib/learn-service";
import { firstParam, pageActor } from "@/lib/page";
import { callName } from "@/lib/person-name";
import { formatBangkok } from "@/lib/time";

export const dynamic = "force-dynamic";

/**
 * หน้าแรก — สรุปของฉัน (ค้าง · เลยกำหนด · ผ่านแล้ว) + สิ่งที่ต้องทำต่อ + ทางลัดตาม role
 * ★ ไม่บังคับยินยอมที่หน้านี้ (ผู้สร้าง/ผู้อนุมัติต้องเข้าถึงหน้าของตัวเองได้) — บอกเป็นแถบแจ้งแทน
 */
export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await pageActor();
  const err = firstParam((await searchParams).err);
  const consented = await hasConsent(actor.personId);
  const [rows, face] = consented ? await Promise.all([myAssignments(actor.personId), enrollmentState(actor.personId)]) : [[], null];
  const now = new Date();
  const open = rows.filter((r) => !r.a.passedAt);
  const overdue = open.filter((r) => r.a.dueAt <= now);
  const passed = rows.filter((r) => r.a.passedAt);

  const shortcuts: { href: string; icon: IconName; title: string; sub: string }[] = [
    { href: "/learn", icon: "book", title: "ชุดที่ต้องเรียน", sub: "อ่านให้ครบแล้วสอบให้ผ่าน 80%" },
    { href: "/dashboard", icon: "chart", title: "Dashboard · Leaderboard", sub: "สถิติของฉันและอันดับประจำเดือน" },
    { href: "/sets", icon: "layers", title: "ชุดการเรียนรู้", sub: "สร้าง · ออกข้อสอบ · อนุมัติ" },
    ...(actor.role === "admin"
      ? [
          { href: "/admin/faces", icon: "shieldAlert" as const, title: "ตรวจภาพใบหน้า", sub: "สแกนไม่ผ่าน 3 ครั้ง · ขอลงทะเบียนใหม่" },
          { href: "/admin/onboarding", icon: "route" as const, title: "เส้นทาง Onboarding", sub: "ผูกชุดกับตำแหน่ง" },
          { href: "/admin/kinds", icon: "grid" as const, title: "ชนิดของชุด", sub: "ชื่อ · แม่แบบข้อสอบ · เปิด/ปิด" },
        ]
      : []),
  ];

  return (
    <main className="mx-auto w-full max-w-5xl">
      <PageHeader kicker="Welcome back" title={`สวัสดี ${callName(actor)}`} subtitle="สิ่งที่ต้องเรียนและสถิติของคุณในที่เดียว" />
      {err && <Alert className="mb-6">{err}</Alert>}
      {!consented && (
        <Alert kind="warn" title="ยังไม่ได้ให้ความยินยอมสแกนใบหน้า" className="mb-6">
          ต้องยินยอมก่อนเริ่มเรียนและสอบ ·{" "}
          <Link href="/consent" className="font-medium underline">
            ไปหน้ายินยอม
          </Link>
        </Alert>
      )}
      {consented && face?.state === "none" && (
        <Alert kind="info" icon="face" title="ยังไม่ได้ลงทะเบียนใบหน้า" className="mb-6">
          ใช้ยืนยันตัวตนตอนเริ่มเรียนและเริ่มสอบ ·{" "}
          <Link href="/enroll" className="font-medium underline">
            ลงทะเบียนตอนนี้
          </Link>
        </Alert>
      )}

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <Stat label="ยังไม่ผ่าน" value={open.length} icon="book" />
        <Stat label="เลยกำหนด" value={overdue.length} icon="clock" hint={overdue.length ? "รีบทำให้เสร็จ" : undefined} />
        <Stat label="ผ่านแล้ว" value={passed.length} icon="check" />
      </div>

      <section className="mt-9">
        <SectionLabel latin right={open.length ? <Link href="/learn" className="hover:text-fg">ดูทั้งหมด</Link> : undefined}>
          Up next
        </SectionLabel>
        {open.length === 0 ? (
          <Card padded={false}>
            <EmptyState compact icon="check" title="ไม่มีชุดค้าง" hint="ชุดใหม่ที่ได้รับมอบจะขึ้นที่นี่ และแจ้งทาง LINE" />
          </Card>
        ) : (
          <div className="divide-y divide-line overflow-hidden rounded-[13px] border border-line bg-raised">
            {open.slice(0, 5).map(({ a, title }) => (
              <Link key={a.id} href={`/learn/${a.id}`} className="flex items-center gap-3.5 px-5 py-4 transition-colors hover:bg-subtle">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-[11px] border border-line bg-subtle text-fg">
                  <Icon name="book" size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-fg">{title}</span>
                  <span className="mt-0.5 block text-xs text-muted">กำหนดส่ง {formatBangkok(a.dueAt)}</span>
                </span>
                {a.dueAt <= now ? <Badge tone="danger" label="เลยกำหนด" /> : a.relearnRequiredAt ? <Badge tone="warning" label="ต้องอ่านใหม่" /> : null}
                <Icon name="chevronRight" size={16} className="text-muted" />
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="mt-9">
        <SectionLabel latin>Shortcuts</SectionLabel>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shortcuts.map((s) => (
            <Link key={s.href} href={s.href} className="press group flex items-start gap-3.5 rounded-[13px] border border-line bg-raised p-5 hover:border-line-strong">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-[11px] border border-line bg-subtle text-fg">
                <Icon name={s.icon} size={18} />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-fg">{s.title}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-muted">{s.sub}</span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      {!consented && (
        <div className="mt-9">
          <Button href="/consent" variant="primary" icon="arrow">
            ไปหน้ายินยอม
          </Button>
        </div>
      )}
    </main>
  );
}
