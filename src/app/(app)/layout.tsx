import { AppShell, type NavSection } from "@/components/app-shell";
import { scanPaused } from "@/lib/identity-service";
import { pageActor } from "@/lib/page";
import { callName } from "@/lib/person-name";

/**
 * โครงของทุกหน้าหลังล็อกอิน — เมนูซ้ายแบบ WorkPass · เมนูตาม role (spec §1)
 * ★ เมนูที่ซ่อนไม่ใช่ด่านกันสิทธิ์ — ทุกหน้ายังเรียก `pageActor()` / `learnerActor()` ของตัวเอง
 */

const ROLE_LABELS = { admin: "TG · ดูแลระบบ", author: "ผู้สร้างชุด", user: "ผู้เรียน" } as const;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await pageActor();
  const sections: NavSection[] = [
    {
      title: "Your learning",
      items: [
        { href: "/", label: "หน้าแรก", icon: "home" },
        { href: "/learn", label: "ชุดที่ต้องเรียน", icon: "book" },
        // พักการสแกนอยู่ = ไม่มีอะไรให้ทำที่หน้าใบหน้า (ADR-0019)
        ...(scanPaused() ? [] : [{ href: "/enroll", label: "ใบหน้าของฉัน", icon: "face" as const }]),
      ],
    },
    {
      title: "Insights",
      items: [{ href: "/dashboard", label: "Dashboard · Leaderboard", icon: "chart" }],
    },
    {
      // ผู้อนุมัติไม่ใช่ role (spec §1) — หัวหน้าที่เป็น user ต้องเปิดชุดที่รอตัวเองอนุมัติได้ จึงเห็นทุกคน
      title: "Library",
      items: [
        { href: "/sets", label: "ชุดการเรียนรู้", icon: "layers" },
        { href: "/sets/released", label: "ชุดที่ปล่อยแล้ว", icon: "grid" },
      ],
    },
    {
      title: "TG",
      items:
        actor.role === "admin"
          ? [
              { href: "/admin/faces", label: "ตรวจภาพใบหน้า", icon: "shieldAlert" },
              { href: "/admin/onboarding", label: "เส้นทาง Onboarding", icon: "route" },
              { href: "/admin/kinds", label: "ชนิดของชุด", icon: "grid" },
              { href: "/admin/api-keys", label: "API Key", icon: "key" },
            ]
          : [],
    },
  ];
  return (
    <AppShell sections={sections} user={{ name: callName(actor), roleLabel: ROLE_LABELS[actor.role], email: actor.email }}>
      {children}
    </AppShell>
  );
}
