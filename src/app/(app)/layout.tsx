import { AppShell, type NavSection } from "@/components/app-shell";
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
        { href: "/enroll", label: "ใบหน้าของฉัน", icon: "face" },
      ],
    },
    {
      title: "Insights",
      items: [{ href: "/dashboard", label: "Dashboard · Leaderboard", icon: "chart" }],
    },
    {
      // ผู้อนุมัติไม่ใช่ role (spec §1) — หัวหน้าที่เป็น user ต้องเปิดชุดที่รอตัวเองอนุมัติได้ จึงเห็นทุกคน
      title: "Library",
      items: [{ href: "/sets", label: "ชุดการเรียนรู้", icon: "layers" }],
    },
    {
      title: "TG",
      items:
        actor.role === "admin"
          ? [
              { href: "/admin/faces", label: "ตรวจภาพใบหน้า", icon: "shieldAlert" },
              { href: "/admin/onboarding", label: "เส้นทาง Onboarding", icon: "route" },
              { href: "/admin/kinds", label: "ชนิดของชุด", icon: "grid" },
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
